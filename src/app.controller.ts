import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('ping')
@Controller()
export class AppController {
    constructor(private readonly appService: AppService) {}

    @Get('ping')
    @ApiOperation({ summary: 'Health check endpoint' })
    @ApiResponse({
        status: 200,
        description: 'Service is healthy',
        schema: { type: 'string', example: 'OK' },
    })
    getHealth(): string {
        return this.appService.getHealth();
    }
}
