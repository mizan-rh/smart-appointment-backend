import { Injectable, Logger } from '@nestjs/common';
import { ActivityType } from '@prisma/client';
import { formatDistanceToNow } from 'date-fns';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ActivityLogService {
    private readonly logger = new Logger(ActivityLogService.name);

    constructor(private prisma: PrismaService) { }

    /* -------------------- GET RECENT LOGS -------------------- */
    async getRecentLogs(userId: string, limit: number = 10) {
        const logs = await this.prisma.activityLog.findMany({
            where: { userId },
            include: {
                appointment: {
                    select: {
                        id: true,
                        customerName: true,
                    },
                },
                staff: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        return logs.map((log) => this.mapLogResponse(log));
    }

    /* -------------------- GET LOGS BY TYPE -------------------- */
    async getLogsByType(userId: string, actionType: ActivityType, limit: number = 10) {
        const logs = await this.prisma.activityLog.findMany({
            where: {
                userId,
                actionType,
            },
            include: {
                appointment: {
                    select: {
                        id: true,
                        customerName: true,
                    },
                },
                staff: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        return logs.map((log) => this.mapLogResponse(log));
    }

    /* -------------------- GET LOGS BY DATE RANGE -------------------- */
    async getLogsByDateRange(
        userId: string,
        startDate: Date,
        endDate: Date,
        limit: number = 50,
    ) {
        const logs = await this.prisma.activityLog.findMany({
            where: {
                userId,
                createdAt: {
                    gte: startDate,
                    lte: endDate,
                },
            },
            include: {
                appointment: {
                    select: {
                        id: true,
                        customerName: true,
                    },
                },
                staff: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        return logs.map((log) => this.mapLogResponse(log));
    }

    /* -------------------- GET LOGS FOR APPOINTMENT -------------------- */
    async getLogsForAppointment(userId: string, appointmentId: string) {
        const logs = await this.prisma.activityLog.findMany({
            where: {
                userId,
                appointmentId,
            },
            include: {
                staff: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
            orderBy: { createdAt: 'asc' },
        });

        return logs.map((log) => this.mapLogResponse(log));
    }

    /* -------------------- GET LOGS FOR STAFF -------------------- */
    async getLogsForStaff(userId: string, staffId: string, limit: number = 20) {
        const logs = await this.prisma.activityLog.findMany({
            where: {
                userId,
                staffId,
            },
            include: {
                appointment: {
                    select: {
                        id: true,
                        customerName: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        return logs.map((log) => this.mapLogResponse(log));
    }

    /* -------------------- GET ACTIVITY STATS -------------------- */
    async getActivityStats(userId: string) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const thisWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const [todayCount, weekCount, monthCount, totalCount] = await Promise.all([
            this.prisma.activityLog.count({
                where: {
                    userId,
                    createdAt: { gte: today },
                },
            }),
            this.prisma.activityLog.count({
                where: {
                    userId,
                    createdAt: { gte: thisWeek },
                },
            }),
            this.prisma.activityLog.count({
                where: {
                    userId,
                    createdAt: { gte: thisMonth },
                },
            }),
            this.prisma.activityLog.count({
                where: { userId },
            }),
        ]);

        // Get counts by action type
        const byType = await this.prisma.activityLog.groupBy({
            by: ['actionType'],
            where: { userId },
            _count: {
                id: true,
            },
        });

        const actionTypeCounts = byType.reduce((acc, item) => {
            acc[item.actionType] = item._count.id;
            return acc;
        }, {} as Record<string, number>);

        return {
            today: todayCount,
            thisWeek: weekCount,
            thisMonth: monthCount,
            total: totalCount,
            byActionType: actionTypeCounts,
        };
    }

    /* -------------------- HELPER: MAP LOG RESPONSE -------------------- */
    private mapLogResponse(log: any) {
        const timeAgo = formatDistanceToNow(log.createdAt, { addSuffix: true });

        return {
            id: log.id,
            actionType: log.actionType,
            description: log.description,
            appointment: log.appointment
                ? {
                    id: log.appointment.id,
                    customerName: log.appointment.customerName,
                }
                : undefined,
            staff: log.staff
                ? {
                    id: log.staff.id,
                    name: log.staff.name,
                }
                : undefined,
            timestamp: log.createdAt,
            timeAgo,
        };
    }
}