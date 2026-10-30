import { Module } from '@nestjs/common';
import { PhotoImportController } from './photo-import.controller';
import { PhotoImportService } from './photo-import.service';
import { BoardsModule } from '../boards/boards.module';
import { LifeAreasModule } from '../life-areas/life-areas.module';

@Module({
  imports: [BoardsModule, LifeAreasModule],
  controllers: [PhotoImportController],
  providers: [PhotoImportService],
})
export class PhotoImportModule {}
