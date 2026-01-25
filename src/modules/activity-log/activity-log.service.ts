import { Injectable, Logger } from '@nestjs/common';
import { formatDistanceToNow } from 'date-fns';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class ActivityLogService {
    private readonly logger = new Logger(ActivityLogService.name);

    constructor(private db: DatabaseService) { }

    /* -------------------- GET RECENT LOGS -------------------- */
    async getRecentLogs(userId: string, limit: number = 10) {
        const logs = await this.db.query`
            SELECT l.*, a.customer_name as "customerName", s.name as "staffName"
            FROM activity_logs l
            LEFT JOIN appointments a ON l.appointment_id = a.id
            LEFT JOIN staff s ON l.staff_id = s.id
            WHERE l.user_id = ${userId}
            ORDER BY l.created_at DESC
            LIMIT ${limit}
        `;

        return logs.map((log: any) => this.mapLogResponse(log));
    }

    /* -------------------- GET LOGS BY TYPE -------------------- */
    async getLogsByType(userId: string, actionType: string, limit: number = 10) {
        const logs = await this.db.query`
            SELECT l.*, a.customer_name as "customerName", s.name as "staffName"
            FROM activity_logs l
            LEFT JOIN appointments a ON l.appointment_id = a.id
            LEFT JOIN staff s ON l.staff_id = s.id
            WHERE l.user_id = ${userId} AND l.action_type = ${actionType}
            ORDER BY l.created_at DESC
            LIMIT ${limit}
        `;

        return logs.map((log: any) => this.mapLogResponse(log));
    }

    /* -------------------- GET LOGS BY DATE RANGE -------------------- */
    async getLogsByDateRange(
        userId: string,
        startDate: Date,
        endDate: Date,
        limit: number = 50,
    ) {
        const logs = await this.db.query`
            SELECT l.*, a.customer_name as "customerName", s.name as "staffName"
            FROM activity_logs l
            LEFT JOIN appointments a ON l.appointment_id = a.id
            LEFT JOIN staff s ON l.staff_id = s.id
            WHERE l.user_id = ${userId} 
              AND l.created_at >= ${startDate.toISOString()} 
              AND l.created_at <= ${endDate.toISOString()}
            ORDER BY l.created_at DESC
            LIMIT ${limit}
        `;

        return logs.map((log: any) => this.mapLogResponse(log));
    }

    /* -------------------- GET LOGS FOR APPOINTMENT -------------------- */
    async getLogsForAppointment(userId: string, appointmentId: string) {
        const logs = await this.db.query`
            SELECT l.*, s.name as "staffName"
            FROM activity_logs l
            LEFT JOIN staff s ON l.staff_id = s.id
            WHERE l.user_id = ${userId} AND l.appointment_id = ${appointmentId}
            ORDER BY l.created_at ASC
        `;

        return logs.map((log: any) => this.mapLogResponse(log));
    }

    /* -------------------- GET LOGS FOR STAFF -------------------- */
    async getLogsForStaff(userId: string, staffId: string, limit: number = 20) {
        const logs = await this.db.query`
            SELECT l.*, a.customer_name as "customerName"
            FROM activity_logs l
            LEFT JOIN appointments a ON l.appointment_id = a.id
            WHERE l.user_id = ${userId} AND l.staff_id = ${staffId}
            ORDER BY l.created_at DESC
            LIMIT ${limit}
        `;

        return logs.map((log: any) => this.mapLogResponse(log));
    }

    /* -------------------- GET ACTIVITY STATS -------------------- */
    async getActivityStats(userId: string) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const thisWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        const [counts] = await this.db.query`
            SELECT 
                COUNT(*) FILTER (WHERE created_at >= ${today})::int as today,
                COUNT(*) FILTER (WHERE created_at >= ${thisWeek})::int as week,
                COUNT(*) FILTER (WHERE created_at >= ${thisMonth})::int as month,
                COUNT(*)::int as total
            FROM activity_logs
            WHERE user_id = ${userId}
        `;

        // Get counts by action type
        const byType = await this.db.query`
            SELECT action_type as "actionType", COUNT(*)::int as count
            FROM activity_logs
            WHERE user_id = ${userId}
            GROUP BY action_type
        `;

        const actionTypeCounts = byType.reduce((acc: any, item: any) => {
            acc[item.actionType] = item.count;
            return acc;
        }, {} as Record<string, number>);

        return {
            today: counts.today,
            thisWeek: counts.week,
            thisMonth: counts.month,
            total: counts.total,
            byActionType: actionTypeCounts,
        };
    }

    /* -------------------- HELPER: MAP LOG RESPONSE -------------------- */
    private mapLogResponse(log: any) {
        const timeAgo = formatDistanceToNow(new Date(log.created_at || log.createdAt), { addSuffix: true });

        return {
            id: log.id,
            actionType: log.action_type || log.actionType,
            description: log.description,
            appointment: log.appointment_id || log.appointmentId
                ? {
                    id: log.appointment_id || log.appointmentId,
                    customerName: log.customerName,
                }
                : undefined,
            staff: log.staff_id || log.staffId
                ? {
                    id: log.staff_id || log.staffId,
                    name: log.staffName,
                }
                : undefined,
            timestamp: log.created_at || log.createdAt,
            createdAt: log.created_at || log.createdAt,
            timeAgo,
        };
    }
}