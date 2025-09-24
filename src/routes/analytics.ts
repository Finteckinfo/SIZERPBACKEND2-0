import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth.js';
import { checkProjectAccess } from '../utils/accessControl.js';

const router = Router();
const prisma = new PrismaClient();

// Helper function to check authentication
const requireAuth = (req: Request, res: Response): boolean => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return false;
  }
  return true;
};

// GET /api/analytics/kanban/:projectId/metrics - Kanban metrics
router.get('/kanban/:projectId/metrics', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { timeRange = '30d', departmentId } = req.query;

    // Check permissions
    if (!requireAuth(req, res)) return;

    const access = await checkProjectAccess(req.user!.id, projectId);
    if (!access.hasAccess) {
      return res.status(403).json({ error: 'Access denied to this project' });
    }

    // Parse time range
    const days = parseInt(timeRange.toString().replace('d', '')) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Build where clause for tasks
    const taskWhere: any = {
      department: { projectId },
      createdAt: { gte: startDate }
    };

    if (departmentId) {
      taskWhere.departmentId = departmentId;
    }

    // Get all tasks in the time range
    const tasks = await prisma.task.findMany({
      where: taskWhere,
      include: {
        department: {
          select: {
            id: true,
            name: true
          }
        },
        activities: {
          where: {
            type: 'STATUS_CHANGED',
            createdAt: { gte: startDate }
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    // Calculate cycle times and lead times
    const completedTasks = tasks.filter(task => 
      task.status === 'COMPLETED' || task.status === 'APPROVED'
    );

    let totalCycleTime = 0;
    let totalLeadTime = 0;
    let tasksWithCycleTime = 0;
    let tasksWithLeadTime = 0;

    for (const task of completedTasks) {
      // Lead time: from creation to completion
      if (task.updatedAt && task.createdAt) {
        const leadTime = task.updatedAt.getTime() - task.createdAt.getTime();
        totalLeadTime += leadTime;
        tasksWithLeadTime++;
      }

      // Cycle time: from first "IN_PROGRESS" to completion
      const inProgressActivity = task.activities.find(
        activity => activity.newValue === 'IN_PROGRESS'
      );
      
      if (inProgressActivity && task.updatedAt) {
        const cycleTime = task.updatedAt.getTime() - inProgressActivity.createdAt.getTime();
        totalCycleTime += cycleTime;
        tasksWithCycleTime++;
      }
    }

    const averageCycleTime = tasksWithCycleTime > 0 
      ? Math.round(totalCycleTime / tasksWithCycleTime / (1000 * 60 * 60 * 24) * 10) / 10 // days
      : 0;

    const averageLeadTime = tasksWithLeadTime > 0
      ? Math.round(totalLeadTime / tasksWithLeadTime / (1000 * 60 * 60 * 24) * 10) / 10 // days
      : 0;

    // Calculate throughput (completed tasks per day)
    const throughput = Math.round(completedTasks.length / days * 10) / 10;

    // Tasks currently in progress
    const tasksInProgress = tasks.filter(task => task.status === 'IN_PROGRESS').length;

    // Identify bottlenecks (statuses with high task counts and long average times)
    const statusCounts = {
      PENDING: tasks.filter(task => task.status === 'PENDING').length,
      IN_PROGRESS: tasks.filter(task => task.status === 'IN_PROGRESS').length,
      COMPLETED: tasks.filter(task => task.status === 'COMPLETED').length,
      APPROVED: tasks.filter(task => task.status === 'APPROVED').length
    };

    const bottlenecks = Object.entries(statusCounts)
      .map(([status, taskCount]) => {
        // Calculate average time in this status
        const statusTasks = tasks.filter(task => task.status === status);
        let totalTimeInStatus = 0;
        let tasksWithTime = 0;

        for (const task of statusTasks) {
          const statusChangeActivity = task.activities.find(
            activity => activity.newValue === status
          );
          
          if (statusChangeActivity) {
            const timeInStatus = new Date().getTime() - statusChangeActivity.createdAt.getTime();
            totalTimeInStatus += timeInStatus;
            tasksWithTime++;
          }
        }

        const averageTimeInStatus = tasksWithTime > 0
          ? Math.round(totalTimeInStatus / tasksWithTime / (1000 * 60 * 60 * 24) * 10) / 10
          : 0;

        // Consider it a bottleneck if more than 30% of tasks are in this status
        // or if average time in status is > 7 days
        const isBottleneck = (taskCount / tasks.length > 0.3) || averageTimeInStatus > 7;

        return {
          status,
          taskCount,
          averageTimeInStatus,
          isBottleneck
        };
      })
      .filter(item => item.isBottleneck);

    // Department performance
    const departmentPerformance = await Promise.all(
      [...new Set(tasks.map(task => task.department))].map(async (dept) => {
        const deptTasks = tasks.filter(task => task.departmentId === dept.id);
        const deptCompletedTasks = deptTasks.filter(task => 
          task.status === 'COMPLETED' || task.status === 'APPROVED'
        ).length;

        let deptTotalCycleTime = 0;
        let deptTasksWithCycleTime = 0;

        for (const task of deptTasks.filter(t => t.status === 'COMPLETED' || t.status === 'APPROVED')) {
          const inProgressActivity = task.activities.find(
            activity => activity.newValue === 'IN_PROGRESS'
          );
          
          if (inProgressActivity && task.updatedAt) {
            const cycleTime = task.updatedAt.getTime() - inProgressActivity.createdAt.getTime();
            deptTotalCycleTime += cycleTime;
            deptTasksWithCycleTime++;
          }
        }

        const deptAverageCycleTime = deptTasksWithCycleTime > 0
          ? Math.round(deptTotalCycleTime / deptTasksWithCycleTime / (1000 * 60 * 60 * 24) * 10) / 10
          : 0;

        return {
          departmentId: dept.id,
          departmentName: dept.name,
          completedTasks: deptCompletedTasks,
          averageCycleTime: deptAverageCycleTime
        };
      })
    );

    res.json({
      projectId,
      timeRange: `${days}d`,
      metrics: {
        averageCycleTime,
        averageLeadTime,
        throughput,
        tasksInProgress,
        completedTasks: completedTasks.length,
        bottlenecks,
        departmentPerformance
      }
    });

  } catch (error) {
    console.error('Error fetching kanban metrics:', error);
    res.status(500).json({ error: 'Failed to fetch kanban metrics' });
  }
});

// GET /api/analytics/kanban/all-projects/metrics - Cross-project analytics
router.get('/kanban/all-projects/metrics', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { timeRange = '30d', projectIds } = req.query;

    // Check permissions
    if (!requireAuth(req, res)) return;

    // Get all projects user has access to
    const userProjects = await prisma.userRole.findMany({
      where: { userId: req.user!.id },
      include: {
        project: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (userProjects.length === 0) {
      return res.json({
        timeRange,
        overallMetrics: {
          averageCycleTime: 0,
          averageLeadTime: 0,
          throughput: 0,
          tasksInProgress: 0,
          completedTasks: 0
        },
        projectBreakdown: [],
        bottlenecks: []
      });
    }

    let accessibleProjectIds = userProjects.map(up => up.projectId);

    // Filter by specific projects if requested
    if (projectIds && Array.isArray(projectIds)) {
      accessibleProjectIds = accessibleProjectIds.filter(id => projectIds.includes(id));
    }

    // Parse time range
    const days = parseInt(timeRange.toString().replace('d', '')) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Build where clause for tasks
    const taskWhere: any = {
      department: { projectId: { in: accessibleProjectIds } },
      createdAt: { gte: startDate }
    };

    // Get all tasks in the time range across all projects
    const tasks = await prisma.task.findMany({
      where: taskWhere,
      include: {
        department: {
          select: {
            id: true,
            name: true,
            project: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        activities: {
          where: {
            type: 'STATUS_CHANGED',
            createdAt: { gte: startDate }
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    // Calculate overall metrics
    const completedTasks = tasks.filter(task => 
      task.status === 'COMPLETED' || task.status === 'APPROVED'
    );

    let totalCycleTime = 0;
    let totalLeadTime = 0;
    let tasksWithCycleTime = 0;
    let tasksWithLeadTime = 0;

    for (const task of completedTasks) {
      // Lead time: from creation to completion
      if (task.updatedAt && task.createdAt) {
        const leadTime = task.updatedAt.getTime() - task.createdAt.getTime();
        totalLeadTime += leadTime;
        tasksWithLeadTime++;
      }

      // Cycle time: from first "IN_PROGRESS" to completion
      const inProgressActivity = task.activities.find(
        activity => activity.newValue === 'IN_PROGRESS'
      );
      
      if (inProgressActivity && task.updatedAt) {
        const cycleTime = task.updatedAt.getTime() - inProgressActivity.createdAt.getTime();
        totalCycleTime += cycleTime;
        tasksWithCycleTime++;
      }
    }

    const overallMetrics = {
      averageCycleTime: tasksWithCycleTime > 0 
        ? Math.round(totalCycleTime / tasksWithCycleTime / (1000 * 60 * 60 * 24) * 10) / 10
        : 0,
      averageLeadTime: tasksWithLeadTime > 0
        ? Math.round(totalLeadTime / tasksWithLeadTime / (1000 * 60 * 60 * 24) * 10) / 10
        : 0,
      throughput: Math.round(completedTasks.length / days * 10) / 10,
      tasksInProgress: tasks.filter(task => task.status === 'IN_PROGRESS').length,
      completedTasks: completedTasks.length
    };

    // Project breakdown
    const projectBreakdown = userProjects
      .filter(up => accessibleProjectIds.includes(up.projectId))
      .map(up => {
        const projectTasks = tasks.filter(task => task.department.project.id === up.projectId);
        const projectCompletedTasks = projectTasks.filter(task => 
          task.status === 'COMPLETED' || task.status === 'APPROVED'
        );

        let projectTotalCycleTime = 0;
        let projectTasksWithCycleTime = 0;

        for (const task of projectCompletedTasks) {
          const inProgressActivity = task.activities.find(
            activity => activity.newValue === 'IN_PROGRESS'
          );
          
          if (inProgressActivity && task.updatedAt) {
            const cycleTime = task.updatedAt.getTime() - inProgressActivity.createdAt.getTime();
            projectTotalCycleTime += cycleTime;
            projectTasksWithCycleTime++;
          }
        }

        return {
          projectId: up.project.id,
          projectName: up.project.name,
          completedTasks: projectCompletedTasks.length,
          averageCycleTime: projectTasksWithCycleTime > 0
            ? Math.round(projectTotalCycleTime / projectTasksWithCycleTime / (1000 * 60 * 60 * 24) * 10) / 10
            : 0,
          throughput: Math.round(projectCompletedTasks.length / days * 10) / 10
        };
      });

    // Identify bottlenecks across all projects
    const statusCounts = {
      PENDING: tasks.filter(task => task.status === 'PENDING').length,
      IN_PROGRESS: tasks.filter(task => task.status === 'IN_PROGRESS').length,
      COMPLETED: tasks.filter(task => task.status === 'COMPLETED').length,
      APPROVED: tasks.filter(task => task.status === 'APPROVED').length
    };

    const bottlenecks = Object.entries(statusCounts)
      .map(([status, taskCount]) => {
        const statusTasks = tasks.filter(task => task.status === status);
        let totalTimeInStatus = 0;
        let tasksWithTime = 0;

        for (const task of statusTasks) {
          const statusChangeActivity = task.activities.find(
            activity => activity.newValue === status
          );
          
          if (statusChangeActivity) {
            const timeInStatus = new Date().getTime() - statusChangeActivity.createdAt.getTime();
            totalTimeInStatus += timeInStatus;
            tasksWithTime++;
          }
        }

        const averageTimeInStatus = tasksWithTime > 0
          ? Math.round(totalTimeInStatus / tasksWithTime / (1000 * 60 * 60 * 24) * 10) / 10
          : 0;

        const isBottleneck = (taskCount / tasks.length > 0.3) || averageTimeInStatus > 7;

        // Get affected projects for this bottleneck
        const affectedProjects = [...new Set(
          statusTasks.map(task => task.department.project.id)
        )];

        return {
          status,
          taskCount,
          averageTimeInStatus,
          isBottleneck,
          affectedProjects
        };
      })
      .filter(item => item.isBottleneck);

    res.json({
      timeRange: `${days}d`,
      overallMetrics,
      projectBreakdown,
      bottlenecks
    });

  } catch (error) {
    console.error('Error fetching cross-project kanban metrics:', error);
    res.status(500).json({ error: 'Failed to fetch kanban metrics' });
  }
});

// NEW: All Projects Performance (aggregated)
router.get('/projects/all/performance', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const { dateRange = '30d', granularity = 'weekly' } = req.query as any;
    const days = parseInt(dateRange.toString().replace('d', '')) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Accessible projects
    const roles = await prisma.userRole.findMany({
      where: { userId: req.user.id },
      select: { projectId: true }
    });
    const projectIds = Array.from(new Set(roles.map(r => r.projectId)));
    if (projectIds.length === 0) return res.json({ dateRange, granularity, metrics: {} });

    // Totals per all projects
    const totalTasks = await prisma.task.count({
      where: { department: { projectId: { in: projectIds } }, createdAt: { gte: startDate } }
    });
    const completedTasks = await prisma.task.count({
      where: {
        department: { projectId: { in: projectIds } },
        status: { in: ['COMPLETED', 'APPROVED'] },
        updatedAt: { gte: startDate }
      }
    });
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const tasksWithDue = await prisma.task.count({
      where: { department: { projectId: { in: projectIds } }, dueDate: { gte: startDate } }
    });
    const completedWithDue = await prisma.task.count({
      where: {
        department: { projectId: { in: projectIds } },
        status: { in: ['COMPLETED', 'APPROVED'] },
        dueDate: { gte: startDate },
        updatedAt: { gte: startDate }
      }
    });
    const timelineProgress = tasksWithDue > 0 ? Math.round((completedWithDue / tasksWithDue) * 100) : 0;

    const completedRecs = await prisma.task.findMany({
      where: {
        department: { projectId: { in: projectIds } },
        status: { in: ['COMPLETED', 'APPROVED'] },
        updatedAt: { gte: startDate }
      },
      select: { updatedAt: true, dueDate: true }
    });
    const withDue = completedRecs.filter(t => t.dueDate != null);
    const onTime = withDue.filter(t => t.updatedAt && t.dueDate && t.updatedAt <= t.dueDate).length;
    const onTimeRate = withDue.length > 0 ? Math.round((onTime / withDue.length) * 100) : 0;

    const members = await prisma.userRole.findMany({
      where: { projectId: { in: projectIds } },
      select: { userId: true }
    });
    const memberCount = Array.from(new Set(members.map(m => m.userId))).length || 1;
    const teamEfficiency = Math.round((completedTasks / memberCount) * 100) / 100;

    const healthScore = Math.round((completionRate * 0.6 + onTimeRate * 0.4));
    const budgetUtilization = null as number | null; // pending budget model

    const overdueOpen = await prisma.task.count({
      where: {
        department: { projectId: { in: projectIds } },
        status: { notIn: ['COMPLETED', 'APPROVED'] },
        dueDate: { lt: new Date() }
      }
    });
    const riskAssessment = [
      { type: 'OVERDUE_OPEN_TASKS', count: overdueOpen, severity: overdueOpen > 25 ? 'HIGH' : overdueOpen > 10 ? 'MEDIUM' : 'LOW' }
    ];

    const milestoneCompletion: any[] = [];

    res.json({
      dateRange,
      granularity,
      projectIds,
      metrics: {
        averageHealthScore: healthScore,
        totalCompletionRate: completionRate,
        budgetUtilization,
        averageTimelineProgress: timelineProgress,
        commonRisks: riskAssessment,
        teamEfficiency,
        milestoneCompletion
      }
    });
  } catch (e) {
    console.error('all-projects performance error', e);
    res.status(500).json({ error: 'Failed to fetch all-projects performance' });
  }
});

// NEW: All Projects Team Performance (aggregated)
router.get('/team/all/performance', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const { dateRange = '30d' } = req.query as any;
    const days = parseInt(dateRange.toString().replace('d', '')) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const roles = await prisma.userRole.findMany({ where: { userId: req.user.id }, select: { projectId: true } });
    const projectIds = Array.from(new Set(roles.map(r => r.projectId)));
    if (projectIds.length === 0) return res.json({ dateRange, members: [], workloadDistribution: [], completionRates: [], collaboration: [], skills: [], trends: [] });

    const tasks = await prisma.task.findMany({
      where: {
        department: { projectId: { in: projectIds } },
        OR: [ { updatedAt: { gte: startDate } }, { createdAt: { gte: startDate } } ]
      },
      select: {
        id: true, status: true, createdAt: true, updatedAt: true,
        assignedRoleId: true,
        assignedRole: { select: { userId: true, role: true } }
      }
    });

    const byUser: Record<string, { userId: string, role: string | null, completed: number, inProgress: number, pending: number }>= {};
    for (const t of tasks) {
      const uid = t.assignedRole?.userId || 'unassigned';
      if (!byUser[uid]) byUser[uid] = { userId: uid, role: t.assignedRole?.role || null, completed: 0, inProgress: 0, pending: 0 };
      if (t.status === 'COMPLETED' || t.status === 'APPROVED') byUser[uid].completed++;
      else if (t.status === 'IN_PROGRESS') byUser[uid].inProgress++;
      else byUser[uid].pending++;
    }

    const members = Object.values(byUser).map(u => ({
      userId: u.userId,
      role: u.role,
      productivityScore: Math.round(Math.min(100, (u.completed / Math.max(1, days)) * 100)),
      completed: u.completed,
      inProgress: u.inProgress,
      pending: u.pending
    }));

    const workloadDistribution = members.map(u => ({ userId: u.userId, openTasks: u.inProgress + u.pending }));
    const completionRates = members.map(u => ({ userId: u.userId, completionRate: Math.round((u.completed / Math.max(1, (u.completed + u.inProgress + u.pending))) * 100) }));

    const collaboration: any[] = [];
    const skills: any[] = [];
    const trends: any[] = [];

    res.json({ dateRange, members, workloadDistribution, completionRates, collaboration, skills, trends });
  } catch (e) {
    console.error('all-projects team performance error', e);
    res.status(500).json({ error: 'Failed to fetch all-projects team performance' });
  }
});

export default router;

// ==========================
// Additional Analytics APIs
// These are lightweight MVP stubs to unblock frontend integration.
// Replace placeholder calculations with real queries once DB is active.
// ==========================

// CORE ANALYTICS
router.get('/dashboard/overview', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const { dateRange = '30d' } = req.query as any;
    const days = parseInt(dateRange.toString().replace('d', '')) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Find projects the user can access
    const userRoles = await prisma.userRole.findMany({
      where: { userId: req.user.id },
      select: { projectId: true, userId: true }
    });
    const accessibleProjectIds = Array.from(new Set(userRoles.map(r => r.projectId)));

    // Totals
    const totalProjects = accessibleProjectIds.length;

    // Completed tasks in range across accessible projects
    const completedTasksCount = await prisma.task.count({
      where: {
        department: { projectId: { in: accessibleProjectIds } },
        status: { in: ['COMPLETED', 'APPROVED'] },
        // Use updatedAt as completion proxy within range
        updatedAt: { gte: startDate }
      }
    });

    // Active projects: projects that have at least one non-completed task
    let activeProjects = 0;
    if (accessibleProjectIds.length > 0) {
      const activeCounts = await prisma.task.groupBy({
        by: ['departmentId'],
        where: {
          department: { projectId: { in: accessibleProjectIds } },
          status: { notIn: ['COMPLETED', 'APPROVED'] }
        },
        _count: { _all: true }
      });
      const departmentIdsWithActive = new Set(activeCounts.map(g => g.departmentId));
      const departments = await prisma.department.findMany({
        where: { id: { in: Array.from(departmentIdsWithActive) } },
        select: { projectId: true }
      });
      const projectIdsWithActive = new Set(departments.map(d => d.projectId));
      activeProjects = Array.from(projectIdsWithActive).length;
    }

    // Team members: distinct users with roles in accessible projects
    const teamUsers = await prisma.userRole.findMany({
      where: { projectId: { in: accessibleProjectIds } },
      select: { userId: true }
    });
    const teamMembers = Array.from(new Set(teamUsers.map(u => u.userId))).length;

    // Productivity score (simple): throughput per day vs target (target 5/day)
    const throughputPerDay = days > 0 ? completedTasksCount / days : 0;
    const productivity = Math.max(0, Math.min(100, Math.round((throughputPerDay / 5) * 100)));

    // Timeline adherence: percent of completed tasks completed on/before dueDate (if set)
    const completedTasks = await prisma.task.findMany({
      where: {
        department: { projectId: { in: accessibleProjectIds } },
        status: { in: ['COMPLETED', 'APPROVED'] },
        updatedAt: { gte: startDate }
      },
      select: { updatedAt: true, dueDate: true }
    });
    const withDue = completedTasks.filter(t => t.dueDate != null);
    const onTime = withDue.filter(t => t.updatedAt && t.dueDate && t.updatedAt <= t.dueDate);
    const timelineAdherence = withDue.length > 0 ? Math.round((onTime.length / withDue.length) * 100) : 0;

    // Budget utilization: unknown without budget data → null
    const budgetUtilization: number | null = null;

    return res.json({
      filters: { userId: req.user.id, dateRange, projectIds: accessibleProjectIds },
      totals: {
        totalProjects,
        activeProjects,
        completedTasks: completedTasksCount,
        teamMembers
      },
      scores: {
        productivity,
        budgetUtilization,
        timelineAdherence
      }
    });
  } catch (e) {
    console.error('overview error', e);
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

router.get('/projects/performance', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const { projectId, dateRange = '30d', granularity = 'weekly' } = req.query as any;
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    // Access check
    const access = await checkProjectAccess(req.user.id, projectId);
    if (!access.hasAccess) return res.status(403).json({ error: 'Access denied to this project' });

    const days = parseInt(dateRange.toString().replace('d', '')) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Total and completed tasks in range
    const totalTasks = await prisma.task.count({
      where: { department: { projectId }, createdAt: { gte: startDate } }
    });
    const completedTasks = await prisma.task.count({
      where: {
        department: { projectId },
        status: { in: ['COMPLETED', 'APPROVED'] },
        updatedAt: { gte: startDate }
      }
    });
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // Timeline progress: completed vs tasks with due dates in range
    const tasksWithDue = await prisma.task.count({
      where: { department: { projectId }, dueDate: { gte: startDate } }
    });
    const completedWithDue = await prisma.task.count({
      where: {
        department: { projectId },
        status: { in: ['COMPLETED', 'APPROVED'] },
        dueDate: { gte: startDate },
        updatedAt: { gte: startDate }
      }
    });
    const timelineProgress = tasksWithDue > 0 ? Math.round((completedWithDue / tasksWithDue) * 100) : 0;

    // On-time percentage
    const completedRecords = await prisma.task.findMany({
      where: {
        department: { projectId },
        status: { in: ['COMPLETED', 'APPROVED'] },
        updatedAt: { gte: startDate }
      },
      select: { updatedAt: true, dueDate: true }
    });
    const withDue = completedRecords.filter(t => t.dueDate != null);
    const onTime = withDue.filter(t => t.updatedAt && t.dueDate && t.updatedAt <= t.dueDate).length;
    const onTimeRate = withDue.length > 0 ? Math.round((onTime / withDue.length) * 100) : 0;

    // Team efficiency: completed per active member (distinct users with roles)
    const projectMembers = await prisma.userRole.findMany({
      where: { projectId },
      select: { userId: true }
    });
    const memberCount = Array.from(new Set(projectMembers.map(m => m.userId))).length || 1;
    const teamEfficiency = Math.round((completedTasks / memberCount) * 100) / 100;

    // Health score: blend of completion and on-time
    const healthScore = Math.round((completionRate * 0.6 + onTimeRate * 0.4));

    // Budget vs actual: no budget fields yet → nulls
    const budgetVsActual = { budget: null as number | null, actual: null as number | null };

    // Risk assessment: simple heuristics
    const overdueOpen = await prisma.task.count({
      where: {
        department: { projectId },
        status: { notIn: ['COMPLETED', 'APPROVED'] },
        dueDate: { lt: new Date() }
      }
    });
    const riskAssessment = [
      { type: 'OVERDUE_OPEN_TASKS', count: overdueOpen, severity: overdueOpen > 10 ? 'HIGH' : overdueOpen > 3 ? 'MEDIUM' : 'LOW' }
    ];

    // Milestone completion: placeholder (no Milestone model yet)
    const milestoneCompletion: any[] = [];

    return res.json({
      projectId,
      dateRange,
      granularity,
      metrics: {
        healthScore,
        completionRate,
        budgetVsActual,
        timelineProgress,
        riskAssessment,
        teamEfficiency,
        milestoneCompletion
      }
    });
  } catch (e) {
    console.error('project performance error', e);
    res.status(500).json({ error: 'Failed to fetch project performance' });
  }
});

router.get('/team/performance', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const { projectId, departmentId, userId, dateRange = '30d' } = req.query as any;
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const access = await checkProjectAccess(req.user.id, projectId);
    if (!access.hasAccess) return res.status(403).json({ error: 'Access denied to this project' });

    const days = parseInt(dateRange.toString().replace('d', '')) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Scope filters
    const taskWhere: any = {
      department: { projectId },
      OR: [
        { updatedAt: { gte: startDate } },
        { createdAt: { gte: startDate } }
      ]
    };
    if (departmentId) taskWhere.departmentId = departmentId;
    if (userId) taskWhere.assignedRole = { userId } as any; // via relation on UserRole if available

    // Pull tasks with assignedRole for attribution
    const tasks = await prisma.task.findMany({
      where: taskWhere,
      select: {
        id: true, status: true, createdAt: true, updatedAt: true, dueDate: true,
        assignedRoleId: true,
        assignedRole: { select: { id: true, userId: true, role: true } }
      }
    });

    // Aggregate by userId
    const byUser: Record<string, { userId: string, role: string | null, completed: number, inProgress: number, pending: number }>
      = {};
    for (const t of tasks) {
      const uid = t.assignedRole?.userId || 'unassigned';
      if (!byUser[uid]) byUser[uid] = { userId: uid, role: t.assignedRole?.role || null as any, completed: 0, inProgress: 0, pending: 0 };
      if (t.status === 'COMPLETED' || t.status === 'APPROVED') byUser[uid].completed++;
      else if (t.status === 'IN_PROGRESS') byUser[uid].inProgress++;
      else byUser[uid].pending++;
    }

    const individuals = Object.values(byUser).map(u => ({
      userId: u.userId,
      role: u.role,
      productivityScore: Math.round(Math.min(100, (u.completed / Math.max(1, days)) * 100)),
      completed: u.completed,
      inProgress: u.inProgress,
      pending: u.pending
    }));

    const workloadDistribution = individuals.map(u => ({ userId: u.userId, openTasks: u.inProgress + u.pending }));
    const taskCompletionRates = individuals.map(u => ({ userId: u.userId, completionRate: Math.round((u.completed / Math.max(1, (u.completed + u.inProgress + u.pending))) * 100) }));

    // Placeholders for collaboration and skills
    const collaboration: any[] = [];
    const skillUtilization: any[] = [];

    // Trends: completed per day (simple)
    const trends: any[] = [];

    return res.json({
      filters: { projectId, departmentId, userId, dateRange },
      individuals,
      workloadDistribution,
      taskCompletionRates,
      collaboration,
      skillUtilization,
      trends
    });
  } catch (e) {
    console.error('team performance error', e);
    res.status(500).json({ error: 'Failed to fetch team performance' });
  }
});

router.get('/financial/overview', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const { projectId, dateRange = '30d', currency = 'USD' } = req.query as any;
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const access = await checkProjectAccess(req.user.id, projectId);
    if (!access.hasAccess) return res.status(403).json({ error: 'Access denied to this project' });

    const days = parseInt(dateRange.toString().replace('d', '')) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Without budget/expense schema, compute operational proxies
    const totalTasks = await prisma.task.count({ where: { department: { projectId }, createdAt: { gte: startDate } } });
    const completedTasks = await prisma.task.count({ where: { department: { projectId }, status: { in: ['COMPLETED','APPROVED'] }, updatedAt: { gte: startDate } } });

    const costPerTask = null as number | null; // pending expense model
    const budgetUtilization = null as number | null; // pending budget model
    const roi = null as number | null; // pending revenue/savings model
    const expenseBreakdown: any[] = []; // pending expense categories
    const profitMargins = null as number | null; // pending revenue model
    const payments: any[] = []; // pending payments model

    // Simple projection: linear based on last period throughput
    const throughputPerDay = days > 0 ? completedTasks / days : 0;
    const projections = [{ metric: 'throughputPerDay', value: Math.round(throughputPerDay * 100) / 100, currency }];

    res.json({
      filters: { projectId, dateRange, currency },
      budgetUtilization,
      costPerTask,
      roi,
      expenseBreakdown,
      profitMargins,
      payments,
      projections
    });
  } catch (e) {
    console.error('financial overview error', e);
    res.status(500).json({ error: 'Failed to fetch financial overview' });
  }
});

router.get('/timeline/analysis', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const { projectId, dateRange = '30d' } = req.query as any;
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const access = await checkProjectAccess(req.user.id, projectId);
    if (!access.hasAccess) return res.status(403).json({ error: 'Access denied to this project' });

    const days = parseInt(dateRange.toString().replace('d', '')) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const completed = await prisma.task.findMany({
      where: { department: { projectId }, status: { in: ['COMPLETED','APPROVED'] }, updatedAt: { gte: startDate } },
      select: { createdAt: true, updatedAt: true, dueDate: true }
    });
    const withDue = completed.filter(t => t.dueDate);
    const onTime = withDue.filter(t => t.updatedAt && t.dueDate && t.updatedAt <= t.dueDate);
    const deadlineAdherence = withDue.length > 0 ? Math.round((onTime.length / withDue.length) * 100) : 0;

    // Schedule variance: avg(actual duration - planned duration) for tasks with dueDate
    let varianceSum = 0; let varianceCount = 0;
    for (const t of withDue) {
      const actual = (t.updatedAt?.getTime() || t.createdAt.getTime()) - t.createdAt.getTime();
      const planned = (t.dueDate!.getTime() - t.createdAt.getTime());
      varianceSum += (actual - planned);
      varianceCount++;
    }
    const scheduleVariance = varianceCount > 0 ? Math.round((varianceSum / varianceCount) / (1000*60*60*24) * 100) / 100 : 0; // in days

    const overdueOpen = await prisma.task.count({ where: { department: { projectId }, status: { notIn: ['COMPLETED','APPROVED'] }, dueDate: { lt: new Date() } } });
    const risks = [{ type: 'OVERDUE_OPEN_TASKS', count: overdueOpen, severity: overdueOpen > 10 ? 'HIGH' : overdueOpen > 3 ? 'MEDIUM' : 'LOW' }];

    // Critical path & milestones: placeholders (no explicit dependency/milestone model)
    const criticalPath: any[] = [];
    const milestones: any[] = [];

    // Delivery predictions: naive estimate using current throughput and remaining open tasks
    const openTasks = await prisma.task.count({ where: { department: { projectId }, status: { notIn: ['COMPLETED','APPROVED'] } } });
    const throughputPerDay = days > 0 ? (completed.length / days) : 0;
    const etaDays = throughputPerDay > 0 ? Math.ceil(openTasks / throughputPerDay) : null;
    const deliveryPredictions = [{ metric: 'etaDays', value: etaDays }];

    res.json({ projectId, dateRange, milestones, deadlineAdherence, scheduleVariance, criticalPath, risks, deliveryPredictions });
  } catch (e) {
    console.error('timeline analysis error', e);
    res.status(500).json({ error: 'Failed to fetch timeline analysis' });
  }
});

// DEPARTMENT & RESOURCE
router.get('/departments/efficiency', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const { projectId, dateRange = '30d' } = req.query as any;
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const access = await checkProjectAccess(req.user.id, projectId);
    if (!access.hasAccess) return res.status(403).json({ error: 'Access denied to this project' });

    const days = parseInt(dateRange.toString().replace('d', '')) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const departments = await prisma.department.findMany({ where: { projectId }, select: { id: true, name: true } });

    const departmentComparison = await Promise.all(departments.map(async d => {
      const total = await prisma.task.count({ where: { departmentId: d.id, createdAt: { gte: startDate } } });
      const completed = await prisma.task.count({ where: { departmentId: d.id, status: { in: ['COMPLETED','APPROVED'] }, updatedAt: { gte: startDate } } });
      const inProgress = await prisma.task.count({ where: { departmentId: d.id, status: 'IN_PROGRESS' } });
      return {
        departmentId: d.id,
        departmentName: d.name,
        total,
        completed,
        inProgress,
        completionRate: total > 0 ? Math.round((completed/total)*100) : 0
      };
    }));

    // Resource utilization proxy: tasks per active member
    const roles = await prisma.userRole.findMany({ where: { projectId }, select: { id: true, userId: true } });
    const uniqueUsers = Array.from(new Set(roles.map(r => r.userId)));
    const totalOpen = await prisma.task.count({ where: { department: { projectId }, status: { notIn: ['COMPLETED','APPROVED'] } } });
    const resourceUtilization = [{ metric: 'tasksPerActiveMember', value: uniqueUsers.length ? Math.round((totalOpen/uniqueUsers.length)*100)/100 : 0 }];

    // Bottlenecks: departments with high IN_PROGRESS or long times
    const bottlenecks = departmentComparison
      .filter(dc => dc.inProgress > Math.max(5, Math.ceil(dc.total * 0.3)))
      .map(dc => ({ departmentId: dc.departmentId, reason: 'HIGH_IN_PROGRESS', level: 'MEDIUM' }));

    // Capacity & workload placeholders
    const capacity = departments.map(d => ({ departmentId: d.id, capacityUnits: null as number | null }));
    const workload = departmentComparison.map(dc => ({ departmentId: dc.departmentId, openTasks: dc.total - dc.completed }));

    res.json({ projectId, dateRange, departmentComparison, resourceUtilization, bottlenecks, capacity, workload });
  } catch (e) {
    console.error('departments efficiency error', e);
    res.status(500).json({ error: 'Failed to fetch department efficiency' });
  }
});

router.get('/resources/utilization', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const { projectId, resourceType = 'human' } = req.query as any;
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const access = await checkProjectAccess(req.user.id, projectId);
    if (!access.hasAccess) return res.status(403).json({ error: 'Access denied to this project' });

    // Human resources proxy
    if (resourceType === 'human') {
      const roles = await prisma.userRole.findMany({ where: { projectId }, select: { userId: true } });
      const members = Array.from(new Set(roles.map(r => r.userId))).length || 1;
      const openTasks = await prisma.task.count({ where: { department: { projectId }, status: { notIn: ['COMPLETED','APPROVED'] } } });
      const completed30 = await prisma.task.count({ where: { department: { projectId }, status: { in: ['COMPLETED','APPROVED'] }, updatedAt: { gte: new Date(Date.now()-30*864e5) } } });

      const capacityVsDemand = [{ capacityUnits: members, demandUnits: openTasks }];
      const utilizationRates = [{ metric: 'tasksPerMember', value: Math.round((openTasks/members)*100)/100 }];
      const optimization = [{ recommendation: 'Balance workload across members with high open tasks' }];
      const allocationEfficiency = Math.round((completed30 / (openTasks + completed30 || 1)) * 100);
      const costPerResource = null as number | null; // pending cost model

      return res.json({ projectId, resourceType, capacityVsDemand, utilizationRates, optimization, allocationEfficiency, costPerResource });
    }

    // Equipment/Budget placeholders until models exist
    return res.json({ projectId, resourceType, capacityVsDemand: [], utilizationRates: [], optimization: [], allocationEfficiency: null, costPerResource: null });
  } catch (e) {
    console.error('resource utilization error', e);
    res.status(500).json({ error: 'Failed to fetch resource utilization' });
  }
});

router.get('/workload/distribution', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const { projectId, teamId, dateRange = '30d' } = req.query as any;
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const access = await checkProjectAccess(req.user.id, projectId);
    if (!access.hasAccess) return res.status(403).json({ error: 'Access denied to this project' });

    const days = parseInt(dateRange.toString().replace('d', '')) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Pull tasks with assignedRole for distribution
    const tasks = await prisma.task.findMany({
      where: { department: { projectId }, OR: [ { updatedAt: { gte: startDate } }, { createdAt: { gte: startDate } } ] },
      select: { id: true, status: true, assignedRole: { select: { userId: true } } }
    });

    const distributionMap: Record<string, { userId: string, open: number, total: number }> = {};
    for (const t of tasks) {
      const uid = t.assignedRole?.userId || 'unassigned';
      if (!distributionMap[uid]) distributionMap[uid] = { userId: uid, open: 0, total: 0 };
      distributionMap[uid].total++;
      if (t.status !== 'COMPLETED' && t.status !== 'APPROVED') distributionMap[uid].open++;
    }
    const distribution = Object.values(distributionMap);

    // Capacity planning (proxy): target open per member <= 5
    const capacityPlanning = distribution.map(d => ({ userId: d.userId, open: d.open, target: 5, delta: d.open - 5 }));

    // Workload balancing recommendations
    const workloadBalancing = distribution
      .filter(d => d.open > 5)
      .map(d => ({ userId: d.userId, recommendation: 'Reassign tasks to members with open <= 3' }));

    // Overtime + productivity placeholders (no time tracking)
    const overtime: any[] = [];
    const productivity: any[] = [];

    res.json({ projectId, teamId, dateRange, distribution, capacityPlanning, workloadBalancing, overtime, productivity });
  } catch (e) {
    console.error('workload distribution error', e);
    res.status(500).json({ error: 'Failed to fetch workload distribution' });
  }
});

// TREND & PREDICTIVE
router.get('/trends/analysis', authenticateToken, async (req: Request, res: Response) => {
  try {
    const projectIds = ([] as string[]).concat(req.query.projectIds as any || []);
    const { metricType, dateRange = '90d', granularity = 'weekly' } = req.query as any;
    res.json({ metricType, dateRange, granularity, projectIds, trends: [], comparisons: [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch trend analysis' });
  }
});

router.get('/predictions/forecast', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId, predictionType = 'completion', horizon = '90d' } = req.query as any;
    res.json({ projectId, predictionType, horizon, predictions: [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch predictions' });
  }
});

router.get('/benchmarks/comparison', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId, benchmarkType = 'historical' } = req.query as any;
    res.json({ projectId, benchmarkType, benchmarks: [], rankings: [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch benchmarks' });
  }
});

// REAL-TIME & LIVE
router.get('/live/dashboard', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const requested = ([] as string[]).concat(req.query.projectIds as any || []);

    const roles = await prisma.userRole.findMany({ where: { userId: req.user.id }, select: { projectId: true } });
    let projectIds = Array.from(new Set(roles.map(r => r.projectId)));
    if (requested.length > 0) projectIds = projectIds.filter(id => requested.includes(id));

    // Status counts
    const statusCounts = await prisma.task.groupBy({
      by: ['status'],
      where: { department: { projectId: { in: projectIds } } },
      _count: { _all: true }
    });
    const status = statusCounts.map(s => ({ status: s.status, count: (s as any)._count._all }));

    // Active tasks list minimal (ids only) to keep payload light
    const activeTasks = await prisma.task.findMany({
      where: { department: { projectId: { in: projectIds } }, status: { in: ['PENDING','IN_PROGRESS'] } },
      select: { id: true, status: true }
    });

    // Alerts from overdue tasks
    const overdue = await prisma.task.count({ where: { department: { projectId: { in: projectIds } }, status: { notIn: ['COMPLETED','APPROVED'] }, dueDate: { lt: new Date() } } });
    const alerts = overdue > 0 ? [{ type: 'DEADLINE', severity: overdue > 25 ? 'HIGH' : overdue > 10 ? 'MEDIUM' : 'LOW', count: overdue }] : [];

    // Productivity snapshot
    const start = new Date(); start.setDate(start.getDate() - 7);
    const completed7 = await prisma.task.count({ where: { department: { projectId: { in: projectIds } }, status: { in: ['COMPLETED','APPROVED'] }, updatedAt: { gte: start } } });
    const productivity = [{ metric: 'throughput7d', value: completed7 }];

    // teamOnline and systemHealth not tracked → placeholders
    const teamOnline: any[] = [];
    const systemHealth = [{ service: 'db', status: 'unknown' }];

    res.json({ userId: req.user.id, projectIds, status, activeTasks, teamOnline, systemHealth, alerts, productivity });
  } catch (e) {
    console.error('live dashboard error', e);
    res.status(500).json({ error: 'Failed to fetch live dashboard' });
  }
});

router.get('/activity/feed', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { userId, projectId, activityType, limit = 20, offset = 0 } = req.query as any;
    res.json({ userId, projectId, activityType, limit: Number(limit), offset: Number(offset), activities: [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch activity feed' });
  }
});

router.get('/alerts/active', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { userId, alertType, severity } = req.query as any;
    res.json({ userId, alertType, severity, alerts: [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// USER-SPECIFIC
router.get('/users/:userId/performance', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const metrics = ([] as string[]).concat(req.query.metrics as any || []);
    const { dateRange = '30d' } = req.query as any;
    res.json({ userId, dateRange, metrics, performance: {}, ranking: {}, goals: {}, achievements: [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch user performance' });
  }
});

router.get('/users/:userId/dashboard', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { viewType = 'personal' } = req.query as any;
    res.json({ userId, viewType, metrics: {}, kpis: {}, quickActions: [], recentActivity: [], upcomingDeadlines: [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch user dashboard' });
  }
});

// ADVANCED
router.get('/bottlenecks/analysis', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId, dateRange = '30d', severity } = req.query as any;
    res.json({ projectId, dateRange, severity, bottlenecks: [], impact: [], recommendations: [], prevention: [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch bottleneck analysis' });
  }
});

router.get('/quality/metrics', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId, dateRange = '30d', qualityType } = req.query as any;
    res.json({ projectId, dateRange, qualityType, taskQuality: [], revisions: [], approvalTimes: [], defects: [], trends: [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch quality metrics' });
  }
});

router.get('/collaboration/metrics', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId, teamId, dateRange = '30d' } = req.query as any;
    res.json({ projectId, teamId, dateRange, communication: [], crossTeam: [], knowledgeSharing: [], meetings: [], patterns: [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch collaboration metrics' });
  }
});

router.get('/reports/custom', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { reportId, dateRange = '30d' } = req.query as any;
    res.json({ reportId, dateRange, data: {}, meta: {} });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch custom report' });
  }
});

router.post('/reports/export', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { reportType, filters, format = 'CSV', email } = req.body || {};
    res.json({ status: 'queued', reportType, format, email, downloadLink: null, progress: 0 });
  } catch (e) {
    res.status(500).json({ error: 'Failed to export report' });
  }
});

router.post('/dashboards/share', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { dashboardId, shareType = 'link', recipients = [], permissions = [] } = req.body || {};
    res.json({ shareLink: 'pending', permissions, recipients, expiration: null, usage: [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to share dashboard' });
  }
});

// CONFIGURATION
router.get('/config/settings', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { userId, configType } = req.query as any;
    res.json({ userId, configType, preferences: {}, layouts: [], metricConfigs: [], alertSettings: [], views: [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch analytics config' });
  }
});

router.get('/widgets/config', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { dashboardId, widgetType } = req.query as any;
    res.json({ dashboardId, widgetType, widgets: [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch widget config' });
  }
});

// PERFORMANCE
router.get('/cache/status', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { cacheType, metricType } = req.query as any;
    res.json({ cacheType, metricType, status: {}, hitRates: {}, schedules: [], recommendations: [], perf: {} });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch cache status' });
  }
});

router.get('/data/freshness', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { dataType, source } = req.query as any;
    res.json({ dataType, source, lastUpdate: null, staleness: null, schedules: [], realtime: false, sync: {} });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch data freshness' });
  }
});