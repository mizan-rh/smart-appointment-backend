import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AssignFromQueueDto } from './dto';
import { QueueService } from './queue.service';

@ApiTags('Queue')
@Controller('queue')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class QueueController {
    constructor(private readonly queueService: QueueService) { }

    @Get()
    @ApiOperation({ summary: 'Get waiting queue' })
    getQueue(@CurrentUser('id') userId: string) {
        return this.queueService.getQueue(userId);
    }

    @Post('assign/:queueEntryId')
    @ApiOperation({ summary: 'Manually assign appointment from queue to staff' })
    assignFromQueue(
        @CurrentUser('id') userId: string,
        @Param('queueEntryId') queueEntryId: string,
        @Body() dto: AssignFromQueueDto,
    ) {
        return this.queueService.assignFromQueue(userId, queueEntryId, dto.staffId);
    }

    @Post('auto-assign')
    @ApiOperation({ summary: 'Auto-assign all queued appointments' })
    autoAssignAll(@CurrentUser('id') userId: string) {
        return this.queueService.autoAssignAll(userId);
    }
}