import { int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const rotaTable = sqliteTable('rota', {
	id: int().primaryKey({ autoIncrement: true }),

	telegramChatId: int('telegram_chat_id').notNull().unique(),

	rota: text({
		enum: ['1', '2', '3', 'OFFICE_HOURS'],
	}).notNull(),
});
