import { WORD_PROGRESS_EVENTS } from '@/messaging/constants';
import { commitCurrentMessage } from '@/messaging/kafka-helpers';
import { Controller } from '@nestjs/common';
import {
  Ctx,
  EventPattern,
  KafkaContext,
  Payload,
} from '@nestjs/microservices';
import {
  BulkAnswerItemDto,
  RecordAnswerDto,
  WordProgressResponseDto,
} from './dto/word-progress.dto';
import { WordProgressService } from './word-progress.service';

/**
 * Handles Kafka events for word-progress. Delegates to WordProgressService.
 * HTTP endpoints stay in WordProgressController.
 * Offsets are committed only after successful processing (autoCommit is disabled in main.ts).
 */
@Controller()
export class WordProgressConsumer {
  constructor(private readonly wordProgressService: WordProgressService) {}

  @EventPattern(WORD_PROGRESS_EVENTS.RECORD_ANSWER)
  async handleRecordAnswer(
    @Payload() payload: RecordAnswerDto,
    @Ctx() context: KafkaContext,
  ): Promise<WordProgressResponseDto> {
    const result = await this.wordProgressService.recordAnswer(payload);
    await commitCurrentMessage(context);
    return result;
  }

  @EventPattern(WORD_PROGRESS_EVENTS.RECORD_ANSWERS_BULK)
  async handleRecordAnswersBulk(
    @Payload() payload: { userLoginId: string; answers: BulkAnswerItemDto[] },
    @Ctx() context: KafkaContext,
  ): Promise<WordProgressResponseDto[]> {
    const result = await this.wordProgressService.recordAnswersBulk(
      payload.userLoginId,
      payload.answers,
    );
    await commitCurrentMessage(context);
    return result;
  }
}
