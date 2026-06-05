import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
    getHealth(): string {
        return 'Learning Service is healthy';
    }
}
