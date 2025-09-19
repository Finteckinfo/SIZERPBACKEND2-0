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

export default router;
