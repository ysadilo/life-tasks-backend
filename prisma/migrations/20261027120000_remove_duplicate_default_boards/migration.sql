-- Concurrent first requests could each bootstrap a "My board" for the same user.
-- Keep each owner's oldest board and delete the extra untouched default ones:
-- unshared, no tasks, and the owner is the only member. Members, invites and
-- life areas go with them via ON DELETE CASCADE.
DELETE FROM "Board" b
WHERE b."name" = 'My board'
  AND NOT b."shared"
  AND NOT EXISTS (SELECT 1 FROM "Task" t WHERE t."boardId" = b."id")
  AND NOT EXISTS (
    SELECT 1 FROM "BoardMember" m WHERE m."boardId" = b."id" AND m."userId" <> b."ownerId"
  )
  AND b."id" <> (
    SELECT o."id" FROM "Board" o
    WHERE o."ownerId" = b."ownerId"
    ORDER BY o."createdAt" ASC, o."id" ASC
    LIMIT 1
  );
