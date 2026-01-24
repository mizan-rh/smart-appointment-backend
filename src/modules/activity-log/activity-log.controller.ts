import {
    Controller,
    Get,
    Param,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ActivityType } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ActivityLogService } from './activity-log.service';

@ApiTags('Activity Logs')
@Controller('activity-logs')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ActivityLogController {
    constructor(private readonly activityLogService: ActivityLogService) { }

    @Get()
    @ApiOperation({ summary: 'Get recent activity logs' })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    getRecentLogs(
        @CurrentUser('id') userId: string,
        @Query('limit') limit?: string,
    ) {
        const limitNum = limit ? parseInt(limit) : 10;
        return this.activityLogService.getRecentLogs(userId, limitNum);
    }

    @Get('stats')
    @ApiOperation({ summary: 'Get activity statistics' })
    getStats(@CurrentUser('id') userId: string) {
        return this.activityLogService.getActivityStats(userId);
    }

    @Get('type/:actionType')
    @ApiOperation({ summary: 'Get logs by action type' })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    getLogsByType(
        @CurrentUser('id') userId: string,
        @Param('actionType') actionType: ActivityType,
        @Query('limit') limit?: string,
    ) {
        const limitNum = limit ? parseInt(limit) : 10;
        return this.activityLogService.getLogsByType(userId, actionType, limitNum);
    }

    @Get('appointment/:appointmentId')
    @ApiOperation({ summary: 'Get logs for specific appointment' })
    getLogsForAppointment(
        @CurrentUser('id') userId: string,
        @Param('appointmentId') appointmentId: string,
    ) {
        return this.activityLogService.getLogsForAppointment(userId, appointmentId);
    }

    @Get('staff/:staffId')
    @ApiOperation({ summary: 'Get logs for specific staff' })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    getLogsForStaff(
        @CurrentUser('id') userId: string,
        @Param('staffId') staffId: string,
        @Query('limit') limit?: string,
    ) {
        const limitNum = limit ? parseInt(limit) : 20;
        return this.activityLogService.getLogsForStaff(userId, staffId, limitNum);
    }

    @Get('date-range')
    @ApiOperation({ summary: 'Get logs by date range' })
    @ApiQuery({ name: 'startDate', required: true })
    @ApiQuery({ name: 'endDate', required: true })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    getLogsByDateRange(
        @CurrentUser('id') userId: string,
        @Query('startDate') startDate: string,
        @Query('endDate') endDate: string,
        @Query('limit') limit?: string,
    ) {
        const limitNum = limit ? parseInt(limit) : 50;
        return this.activityLogService.getLogsByDateRange(
            userId,
            new Date(startDate),
            new Date(endDate),
            limitNum,
        );
    }
}