import express from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export function setupCspReportRoutes(app: express.Application) {
  app.post('/api/csp-report', async (req, res) => {
    try {
      const report = req.body;
      
      // Log the violation to the database
      await prisma.cspViolation.create({
        data: {
          documentUri: report['document-uri'],
          referrer: report.referrer || '',
          violatedDirective: report['violated-directive'],
          effectiveDirective: report['effective-directive'],
          originalPolicy: report['original-policy'],
          sourceFile: report['source-file'] || '',
          lineNumber: report['line-number'] || 0,
          columnNumber: report['column-number'] || 0,
          blockedUri: report['blocked-uri'] || '',
          statusCode: report['status-code'] || 0,
          userAgent: req.headers['user-agent'] || '',
          ip: req.headers['x-forwarded-for']?.toString() || req.socket.remoteAddress || '',
          report: JSON.stringify(report)
        }
      });
      
      return res.status(200).json({ status: 'success' });
    } catch (error: any) {
      console.error('CSP Violation Error:', error);
      return res.status(200).json({ status: 'failed', error: error.message });
    }
  });
}
