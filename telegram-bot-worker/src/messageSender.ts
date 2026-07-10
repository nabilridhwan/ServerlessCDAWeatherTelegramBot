import { Context, Api, Bot, RawApi } from 'grammy';

interface SendOptions {
	editMessageId?: number;
}

interface TelegramError {
	response?: {
		error_code?: number;
		parameters?: {
			retry_after?: number;
		};
	};
	code?: string;
}

/**
 * Workers-native message sender with built-in rate limiting
 * No external queue library needed
 */
export class WorkerMessageSender {
	private readonly MAX_RETRIES = 3;
	private readonly BASE_DELAY_MS = 300;
	private readonly RATE_LIMIT_MS = 100; // Min delay between sends (Telegram allows ~30-40 msgs/sec)

	constructor(private bot: Bot<Context, Api<RawApi>>) {}

	/**
	 * Send message to multiple chat IDs with controlled rate limiting
	 */
	async sendToMultiple(chatIds: number[], message: string, options: SendOptions = {}): Promise<void> {
		const results = await Promise.allSettled(
			chatIds.map((chatId, index) =>
				// Stagger requests to respect rate limits
				this.sendWithDelay(chatId, message, options, index),
			),
		);

		// Log failures
		results.forEach((result, index) => {
			if (result.status === 'rejected') {
				console.error(`Failed to send message to chat ${chatIds[index]}:`, result.reason);
			}
		});
	}

	/**
	 * Send to a single chat with delay and retry logic
	 */
	private async sendWithDelay(chatId: number, message: string, options: SendOptions, index: number): Promise<void> {
		// Stagger sends to respect rate limits
		const delay = index * this.RATE_LIMIT_MS;
		await this.sleep(delay);

		await this.sendWithRetry(chatId, message, options);
	}

	/**
	 * Send with exponential backoff retry
	 */
	private async sendWithRetry(chatId: number, message: string, options: SendOptions): Promise<void> {
		let lastError: unknown;

		for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
			try {
				if (options.editMessageId) {
					await this.bot.api.editMessageText(chatId, options.editMessageId, message, {
						parse_mode: 'HTML',
					});
					console.log(`Message edited for chat ${chatId}`);
				} else {
					await this.bot.api.sendMessage(chatId, message, {
						parse_mode: 'HTML',
					});
					console.log(`Message sent to chat ${chatId}`);
				}
				return; // Success
			} catch (error) {
				lastError = error;

				if (attempt === this.MAX_RETRIES) {
					break; // Last attempt failed
				}

				if (!this.isRetryable(error)) {
					throw error; // Non-retryable error
				}

				const delayMs = this.getRetryDelay(error, attempt);
				console.warn(`Retrying send to chat ${chatId} (attempt ${attempt + 1}/${this.MAX_RETRIES}) in ${delayMs}ms`);
				await this.sleep(delayMs);
			}
		}

		throw lastError;
	}

	private isRetryable(error: unknown): boolean {
		const tgError = error as TelegramError;
		const code = tgError.response?.error_code;

		// Retry on rate limit or 5xx errors
		if (code === 429 || (typeof code === 'number' && code >= 500)) {
			return true;
		}

		// Retry on network errors
		const networkErrors = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'];
		return networkErrors.includes(tgError.code || '');
	}

	private getRetryDelay(error: unknown, attempt: number): number {
		const tgError = error as TelegramError;
		const retryAfter = tgError.response?.parameters?.retry_after;

		if (typeof retryAfter === 'number' && retryAfter > 0) {
			return retryAfter * 1000;
		}

		// Exponential backoff with jitter
		const jitter = Math.floor(Math.random() * 100);
		return this.BASE_DELAY_MS * Math.pow(2, attempt - 1) + jitter;
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
