import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto, UpdateAppointmentDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Appointments')
@Controller('appointments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new appointment' })
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateAppointmentDto,
  ) {
    return this.appointmentsService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all appointments' })
  @ApiQuery({ name: 'date', required: false, type: String })
  @ApiQuery({ name: 'staffId', required: false, type: String })
  findAll(
    @CurrentUser('id') userId: string,
    @Query('date') date?: string,
    @Query('staffId') staffId?: string,
  ) {
    const queryDate = date ? new Date(date) : undefined;
    return this.appointmentsService.findAll(userId, queryDate, staffId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get appointment by ID' })
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.appointmentsService.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update appointment' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentDto,
  ) {
    return this.appointmentsService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel appointment' })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.appointmentsService.cancel(userId, id);
  }
}