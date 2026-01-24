import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateStaffDto, UpdateStaffDto } from './dto';
import { StaffService } from './staff.service';

@ApiTags('Staff')
@Controller('staff')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class StaffController {
    constructor(private readonly staffService: StaffService) { }

    @Post()
    @ApiOperation({ summary: 'Create a new staff member' })
    create(@CurrentUser('id') userId: string, @Body() dto: CreateStaffDto) {
        return this.staffService.create(userId, dto);
    }

    @Get()
    @ApiOperation({ summary: 'Get all staff members' })
    @ApiQuery({ name: 'date', required: false, type: String })
    findAll(
        @CurrentUser('id') userId: string,
        @Query('date') date?: string,
    ) {
        const queryDate = date ? new Date(date) : undefined;
        return this.staffService.findAll(userId, queryDate);
    }

    @Get('available')
    @ApiOperation({ summary: 'Get available staff for a service' })
    @ApiQuery({ name: 'serviceType', required: true })
    @ApiQuery({ name: 'date', required: true })
    @ApiQuery({ name: 'time', required: true })
    @ApiQuery({ name: 'duration', required: true, type: Number })
    getAvailable(
        @CurrentUser('id') userId: string,
        @Query('serviceType') serviceType: string,
        @Query('date') date: string,
        @Query('time') time: string,
        @Query('duration') duration: string,
    ) {
        return this.staffService.getAvailableStaff(
            userId,
            serviceType,
            new Date(date),
            time,
            parseInt(duration),
        );
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get staff member by ID' })
    findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
        return this.staffService.findOne(userId, id);
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Update staff member' })
    update(
        @CurrentUser('id') userId: string,
        @Param('id') id: string,
        @Body() dto: UpdateStaffDto,
    ) {
        return this.staffService.update(userId, id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete staff member' })
    remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
        return this.staffService.remove(userId, id);
    }
}