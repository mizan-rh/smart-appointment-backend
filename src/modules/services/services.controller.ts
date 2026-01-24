import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateServiceDto, UpdateServiceDto } from './dto';
import { ServicesService } from './services.service';

@ApiTags('Services')
@Controller('services')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ServicesController {
    constructor(private readonly servicesService: ServicesService) { }

    @Post()
    @ApiOperation({ summary: 'Create a new service' })
    create(@CurrentUser('id') userId: string, @Body() dto: CreateServiceDto) {
        return this.servicesService.create(userId, dto);
    }

    @Get()
    @ApiOperation({ summary: 'Get all services' })
    findAll(@CurrentUser('id') userId: string) {
        return this.servicesService.findAll(userId);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get service by ID' })
    findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
        return this.servicesService.findOne(userId, id);
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Update service' })
    update(
        @CurrentUser('id') userId: string,
        @Param('id') id: string,
        @Body() dto: UpdateServiceDto,
    ) {
        return this.servicesService.update(userId, id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete service' })
    remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
        return this.servicesService.remove(userId, id);
    }
}