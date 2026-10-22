import { TaskGroupBy, TaskSort } from '@prisma/client';

export class UpdatePreferencesDto {
  todaySortBy?: TaskSort;
  backlogGroupBy?: TaskGroupBy;
}
