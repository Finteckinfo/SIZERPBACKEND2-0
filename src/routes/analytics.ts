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

export default router;
