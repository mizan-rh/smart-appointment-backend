import { Injectable, Logger } from '@nestjs/common';
import { endOfDay, endOfWeek, formatDistanceToNow, startOfDay, startOfWeek } from 'date-fns';
import { PrismaService } from '../../database/prisma.service';
import { StaffService } from '../staff/staff.service';

@Injectable()
export class DashboardService {
    private readonly logger = new Logger(DashboardService.name);

    constructor(
        private prisma: PrismaService,
        private staffService: StaffService,
    ) { }

    /* -------------------- GET DASHBOARD METRICS -------------------- */
    async getDashboardMetrics(userId: string, date?: Date) {
        const targetDate = date || new Date();
        const startDate = startOfDay(targetDate);
        const endDate = endOfDay(targetDate);

        // Appointments metrics
        const [totalToday, completed, pending, cancelled, noShow] = await Promise.all([
            this.prisma.appointment.count({
                where: {
                    userId,
                    appointmentDate: targetDate,
                },
            }),
            this.prisma.appointment.count({
                where: {
                    userId,
                    appointmentDate: targetDate,
                    status: 'COMPLETED',
                },
            }),
            this.prisma.appointment.count({
                where: {
                    userId,
                    appointmentDate: targetDate,
                    status: 'SCHEDULED',
                },
            }),
            this.prisma.appointment.count({
                where: {
                    userId,
                    appointmentDate: targetDate,
                    status: 'CANCELLED',
                },
            }),
            this.prisma.appointment.count({
                where: {
                    userId,
                    appointmentDate: targetDate,
                    status: 'NO_SHOW',
                },
            }),
        ]);

        const completionRate = totalToday > 0 ? (completed / totalToday) * 100 : 0;

        // Queue metrics
        const queueEntries = await this.prisma.queueEntry.findMany({
            include: {
                appointment: true,
            },
            orderBy: { addedAt: 'asc' },
        });

        const userQueue = queueEntries.filter((q) => q.appointment.userId === userId);
        const totalInQueue = userQueue.length;

        let oldestWaitTime = 'N/A';
        let averageWaitTime = 'N/A';

        if (totalInQueue > 0) {
            const oldestEntry = userQueue[0];
            oldestWaitTime = formatDistanceToNow(oldestEntry.addedAt);

            const totalWaitMinutes = userQueue.reduce((sum, q) => {
                const waitTime = Date.now() - q.addedAt.getTime();
                return sum + waitTime / 1000 / 60;
            }, 0);

            const avgMinutes = totalWaitMinutes / totalInQueue;
            averageWaitTime = `${Math.round(avgMinutes)} minutes`;
        }

        // Staff metrics
        const allStaff = await this.prisma.staff.findMany({
            where: { userId },
        });

        const totalStaff = allStaff.length;
        const available = allStaff.filter((s) => s.status === 'AVAILABLE').length;
        const onLeave = allStaff.filter((s) => s.status === 'ON_LEAVE').length;

        const loadSummary = await Promise.all(
            allStaff.map(async (staff) => {
                const currentLoad = await this.staffService.getStaffLoadForDate(
                    staff.id,
                    targetDate,
                );
                const percentage = (currentLoad / staff.dailyCapacity) * 100;

                let status: 'OK' | 'BUSY' | 'FULL' | 'OVERBOOKED';
                if (currentLoad > staff.dailyCapacity) {
                    status = 'OVERBOOKED';
                } else if (currentLoad === staff.dailyCapacity) {
                    status = 'FULL';
                } else if (currentLoad / staff.dailyCapacity >= 0.8) {
                    status = 'BUSY';
                } else {
                    status = 'OK';
                }

                return {
                    id: staff.id,
                    name: staff.name,
                    currentLoad,
                    capacity: staff.dailyCapacity,
                    percentage: Math.round(percentage),
                    status,
                };
            }),
        );

        // Recent activity (last 5)
        const recentActivity = await this.prisma.activityLog.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 5,
        });

        const recentActivityMapped = recentActivity.map((log) => ({
            id: log.id,
            description: log.description,
            timestamp: log.createdAt,
            timeAgo: formatDistanceToNow(log.createdAt, { addSuffix: true }),
        }));

        return {
            appointments: {
                totalToday,
                completed,
                pending,
                cancelled,
                noShow,
                completionRate: Math.round(completionRate),
            },
            queue: {
                totalInQueue,
                oldestWaitTime,
                averageWaitTime,
            },
            staff: {
                totalStaff,
                available,
                onLeave,
                loadSummary: loadSummary.sort((a, b) => b.percentage - a.percentage),
            },
            recentActivity: recentActivityMapped,
        };
    }

    /* -------------------- GET APPOINTMENT STATISTICS -------------------- */
    async getAppointmentStats(userId: string, startDate?: Date, endDate?: Date) {
        const start = startDate || startOfWeek(new Date());
        const end = endDate || endOfWeek(new Date());

        // Total appointments
        const total = await this.prisma.appointment.count({
            where: {
                userId,
                appointmentDate: {
                    gte: start,
                    lte: end,
                },
            },
        });

        // By status
        const [scheduled, completed, cancelled, noShow, inQueue] = await Promise.all([
            this.prisma.appointment.count({
                where: { userId, status: 'SCHEDULED', appointmentDate: { gte: start, lte: end } },
            }),
            this.prisma.appointment.count({
                where: { userId, status: 'COMPLETED', appointmentDate: { gte: start, lte: end } },
            }),
            this.prisma.appointment.count({
                where: { userId, status: 'CANCELLED', appointmentDate: { gte: start, lte: end } },
            }),
            this.prisma.appointment.count({
                where: { userId, status: 'NO_SHOW', appointmentDate: { gte: start, lte: end } },
            }),
            this.prisma.appointment.count({
                where: { userId, status: 'IN_QUEUE' },
            }),
        ]);

        // By date (daily breakdown)
        const appointments = await this.prisma.appointment.findMany({
            where: {
                userId,
                appointmentDate: {
                    gte: start,
                    lte: end,
                },
            },
            select: {
                appointmentDate: true,
            },
        });

        const byDateMap = appointments.reduce((acc, appt) => {
            const dateKey = appt.appointmentDate.toISOString().split('T')[0];
            acc[dateKey] = (acc[dateKey] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const byDate = Object.entries(byDateMap).map(([date, count]) => ({
            date,
            count,
        }));

        // Upcoming
        const today = startOfDay(new Date());
        const upcomingToday = await this.prisma.appointment.count({
            where: {
                userId,
                appointmentDate: today,
                status: 'SCHEDULED',
            },
        });

        const upcomingThisWeek = await this.prisma.appointment.count({
            where: {
                userId,
                appointmentDate: {
                    gte: today,
                    lte: endOfWeek(new Date()),
                },
                status: 'SCHEDULED',
            },
        });

        return {
            total,
            byStatus: {
                scheduled,
                completed,
                cancelled,
                noShow,
                inQueue,
            },
            byDate,
            upcomingToday,
            upcomingThisWeek,
        };
    }

    /* -------------------- GET STAFF PERFORMANCE -------------------- */
    async getStaffPerformance(userId: string, staffId?: string) {
        const staffFilter = staffId ? { id: staffId, userId } : { userId };

        const staff = await this.prisma.staff.findMany({
            where: staffFilter,
        });

        const performance = await Promise.all(
            staff.map(async (s) => {
                const [total, completed, cancelled, noShow] = await Promise.all([
                    this.prisma.appointment.count({
                        where: { staffId: s.id },
                    }),
                    this.prisma.appointment.count({
                        where: { staffId: s.id, status: 'COMPLETED' },
                    }),
                    this.prisma.appointment.count({
                        where: { staffId: s.id, status: 'CANCELLED' },
                    }),
                    this.prisma.appointment.count({
                        where: { staffId: s.id, status: 'NO_SHOW' },
                    }),
                ]);

                const completionRate = total > 0 ? (completed / total) * 100 : 0;

                // Average load over last 7 days
                const last7Days = Array.from({ length: 7 }, (_, i) => {
                    const date = new Date();
                    date.setDate(date.getDate() - i);
                    return startOfDay(date);
                });

                const loadSum = await Promise.all(
                    last7Days.map((date) =>
                        this.staffService.getStaffLoadForDate(s.id, date),
                    ),
                );

                const avgLoad = loadSum.reduce((sum, load) => sum + load, 0) / 7;
                const avgLoadPercentage = (avgLoad / s.dailyCapacity) * 100;

                return {
                    staffId: s.id,
                    staffName: s.name,
                    totalAppointments: total,
                    completedAppointments: completed,
                    cancelledAppointments: cancelled,
                    noShowAppointments: noShow,
                    completionRate: Math.round(completionRate),
                    averageLoadPercentage: Math.round(avgLoadPercentage),
                };
            }),
        );

        return staffId ? performance[0] : performance;
    }
}