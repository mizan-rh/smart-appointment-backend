import {
    Controller,
    Get,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DashboardController {
    constructor(private readonly dashboardService: DashboardService) { }

    @Get('metrics')
    @ApiOperation({ summary: 'Get dashboard metrics overview' })
    @ApiQuery({ name: 'date', required: false, type: String })
    getMetrics(
        @CurrentUser('id') userId: string,
        @Query('date') date?: string,
    ) {
        const queryDate = date ? new Date(date) : undefined;
        return this.dashboardService.getDashboardMetrics(userId, queryDate);
    }

    @Get('appointments/stats')
    @ApiOperation({ summary: 'Get appointment statistics' })
    @ApiQuery({ name: 'startDate', required: false, type: String })
    @ApiQuery({ name: 'endDate', required: false, type: String })
    getAppointmentStats(
        @CurrentUser('id') userId: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
    ) {
        const start = startDate ? new Date(startDate) : undefined;
        const end = endDate ? new Date(endDate) : undefined;
        return this.dashboardService.getAppointmentStats(userId, start, end);
    }

    @Get('staff/performance')
    @ApiOperation({ summary: 'Get staff performance metrics' })
    @ApiQuery({ name: 'staffId', required: false, type: String })
    getStaffPerformance(
        @CurrentUser('id') userId: string,
        @Query('staffId') staffId?: string,
    ) {
        return this.dashboardService.getStaffPerformance(userId, staffId);
    }
}