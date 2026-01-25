import { Injectable, Logger } from '@nestjs/common';
import { endOfWeek, formatDistanceToNow, startOfDay, startOfWeek } from 'date-fns';
import { DatabaseService } from '../../database/database.service';
import { StaffService } from '../staff/staff.service';

@Injectable()
export class DashboardService {
    private readonly logger = new Logger(DashboardService.name);

    constructor(
        private db: DatabaseService,
        private staffService: StaffService,
    ) { }

    /* -------------------- GET DASHBOARD METRICS -------------------- */
    async getDashboardMetrics(userId: string, date?: Date) {
        const targetDate = date || new Date();
        const dateStr = targetDate.toISOString().split('T')[0];

        // Appointments metrics
        const [counts] = await this.db.query`
            SELECT 
                COUNT(*)::int as total,
                COUNT(*) FILTER (WHERE status = 'COMPLETED')::int as completed,
                COUNT(*) FILTER (WHERE status = 'SCHEDULED')::int as pending,
                COUNT(*) FILTER (WHERE status = 'CANCELLED')::int as cancelled,
                COUNT(*) FILTER (WHERE status = 'NO_SHOW')::int as no_show
            FROM appointments
            WHERE user_id = ${userId} AND appointment_date = ${dateStr}
        `;

        const totalToday = counts.total;
        const completed = counts.completed;
        const pending = counts.pending;
        const cancelled = counts.cancelled;
        const noShow = counts.no_show;

        const completionRate = totalToday > 0 ? (completed / totalToday) * 100 : 0;

        // Queue metrics
        const userQueue = await this.db.query`
            SELECT q.*, a.user_id
            FROM queue_entries q
            JOIN appointments a ON q.appointment_id = a.id
            WHERE a.user_id = ${userId}
            ORDER BY q.added_at ASC
        `;
        const totalInQueue = userQueue.length;

        let oldestWaitTime = 'N/A';
        let averageWaitTime = 'N/A';

        if (totalInQueue > 0) {
            const oldestEntry = userQueue[0];
            oldestWaitTime = formatDistanceToNow(new Date(oldestEntry.added_at));

            const totalWaitMinutes = userQueue.reduce((sum: number, q: any) => {
                const waitTime = Date.now() - new Date(q.added_at).getTime();
                return sum + waitTime / 1000 / 60;
            }, 0);

            const avgMinutes = totalWaitMinutes / totalInQueue;
            averageWaitTime = `${Math.round(avgMinutes)} minutes`;
        }

        // Staff metrics
        const allStaff = await this.db.query`
            SELECT * FROM staff WHERE user_id = ${userId}
        `;

        const totalStaff = allStaff.length;
        const available = allStaff.filter((s) => s.status === 'AVAILABLE').length;
        const onLeave = allStaff.filter((s) => s.status === 'ON_LEAVE').length;

        const loadSummary = await Promise.all(
            allStaff.map(async (staff: any) => {
                const currentLoad = await this.staffService.getStaffLoadForDate(
                    staff.id,
                    targetDate,
                );
                const percentage = (currentLoad / (staff.daily_capacity || staff.dailyCapacity)) * 100;

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
                    capacity: staff.daily_capacity || staff.dailyCapacity,
                    percentage: Math.round(percentage),
                    status,
                };
            }),
        );

        // Recent activity (last 5)
        const recentActivity = await this.db.query`
            SELECT * FROM activity_logs 
            WHERE user_id = ${userId}
            ORDER BY created_at DESC
            LIMIT 5
        `;

        const recentActivityMapped = recentActivity.map((log: any) => ({
            id: log.id,
            description: log.description,
            timestamp: log.created_at || log.createdAt,
            timeAgo: formatDistanceToNow(new Date(log.created_at || log.createdAt), { addSuffix: true }),
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
        const start = (startDate || startOfWeek(new Date())).toISOString().split('T')[0];
        const end = (endDate || endOfWeek(new Date())).toISOString().split('T')[0];

        // Total and by status
        const [counts] = await this.db.query`
            SELECT 
                COUNT(*)::int as total,
                COUNT(*) FILTER (WHERE status = 'SCHEDULED' AND appointment_date >= ${start} AND appointment_date <= ${end})::int as scheduled,
                COUNT(*) FILTER (WHERE status = 'COMPLETED' AND appointment_date >= ${start} AND appointment_date <= ${end})::int as completed,
                COUNT(*) FILTER (WHERE status = 'CANCELLED' AND appointment_date >= ${start} AND appointment_date <= ${end})::int as cancelled,
                COUNT(*) FILTER (WHERE status = 'NO_SHOW' AND appointment_date >= ${start} AND appointment_date <= ${end})::int as no_show,
                COUNT(*) FILTER (WHERE status = 'IN_QUEUE')::int as in_queue
            FROM appointments
            WHERE user_id = ${userId}
        `;

        // By date (daily breakdown)
        const appointments = await this.db.query`
            SELECT appointment_date as "appointmentDate"
            FROM appointments
            WHERE user_id = ${userId} AND appointment_date >= ${start} AND appointment_date <= ${end}
        `;

        const byDateMap = appointments.reduce((acc: Record<string, number>, appt: any) => {
            const dateStr = new Date(appt.appointmentDate).toISOString().split('T')[0];
            acc[dateStr] = (acc[dateStr] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const byDate = Object.entries(byDateMap).map(([date, count]) => ({
            date,
            count,
        }));

        // Upcoming
        const today = startOfDay(new Date()).toISOString().split('T')[0];
        const weekEnd = endOfWeek(new Date()).toISOString().split('T')[0];

        const [upcoming] = await this.db.query`
            SELECT 
                COUNT(*) FILTER (WHERE appointment_date = ${today} AND status = 'SCHEDULED')::int as today,
                COUNT(*) FILTER (WHERE appointment_date >= ${today} AND appointment_date <= ${weekEnd} AND status = 'SCHEDULED')::int as week
            FROM appointments
            WHERE user_id = ${userId}
        `;

        return {
            total: counts.total,
            byStatus: {
                scheduled: counts.scheduled,
                completed: counts.completed,
                cancelled: counts.cancelled,
                noShow: counts.no_show,
                inQueue: counts.in_queue,
            },
            byDate,
            upcomingToday: upcoming.today,
            upcomingThisWeek: upcoming.week,
        };
    }

    /* -------------------- GET STAFF PERFORMANCE -------------------- */
    async getStaffPerformance(userId: string, staffId?: string) {
        const staff = await this.db.query`
            SELECT id, name, daily_capacity as "dailyCapacity" 
            FROM staff 
            WHERE user_id = ${userId} ${staffId ? this.db.raw`AND id = ${staffId}` : this.db.raw``}
        `;

        const performance = await Promise.all(
            staff.map(async (s: any) => {
                const [counts] = await this.db.query`
                    SELECT 
                        COUNT(*)::int as total,
                        COUNT(*) FILTER (WHERE status = 'COMPLETED')::int as completed,
                        COUNT(*) FILTER (WHERE status = 'CANCELLED')::int as cancelled,
                        COUNT(*) FILTER (WHERE status = 'NO_SHOW')::int as no_show
                    FROM appointments
                    WHERE staff_id = ${s.id}
                `;

                const completionRate = counts.total > 0 ? (counts.completed / counts.total) * 100 : 0;

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
                    totalAppointments: counts.total,
                    completedAppointments: counts.completed,
                    cancelledAppointments: counts.cancelled,
                    noShowAppointments: counts.no_show,
                    completionRate: Math.round(completionRate),
                    averageLoadPercentage: Math.round(avgLoadPercentage),
                };
            }),
        );

        return staffId ? performance[0] : performance;
    }
}