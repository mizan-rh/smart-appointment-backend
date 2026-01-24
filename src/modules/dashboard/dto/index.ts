export class DashboardMetricsDto {
    appointments: {
        totalToday: number;
        completed: number;
        pending: number;
        cancelled: number;
        noShow: number;
        completionRate: number;
    };
    queue: {
        totalInQueue: number;
        oldestWaitTime: string;
        averageWaitTime: string;
    };
    staff: {
        totalStaff: number;
        available: number;
        onLeave: number;
        loadSummary: Array<{
            id: string;
            name: string;
            currentLoad: number;
            capacity: number;
            percentage: number;
            status: 'OK' | 'BUSY' | 'FULL' | 'OVERBOOKED';
        }>;
    };
    recentActivity: Array<{
        id: string;
        description: string;
        timestamp: Date;
        timeAgo: string;
    }>;
}

export class AppointmentStatsDto {
    total: number;
    byStatus: {
        scheduled: number;
        completed: number;
        cancelled: number;
        noShow: number;
        inQueue: number;
    };
    byDate: Array<{
        date: string;
        count: number;
    }>;
    upcomingToday: number;
    upcomingThisWeek: number;
}

export class StaffPerformanceDto {
    staffId: string;
    staffName: string;
    totalAppointments: number;
    completedAppointments: number;
    cancelledAppointments: number;
    noShowAppointments: number;
    completionRate: number;
    averageLoadPercentage: number;
}