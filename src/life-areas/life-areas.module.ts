import { Module } from '@nestjs/common';
import { LifeAreasController } from './life-areas.controller';
import { LifeAreasService } from './life-areas.service';
import { BoardsModule } from '../boards/boards.module';

@Module({
  imports: [BoardsModule],
  controllers: [LifeAreasController],
  providers: [LifeAreasService],
  exports: [LifeAreasService],
})
export class LifeAreasModule {}
