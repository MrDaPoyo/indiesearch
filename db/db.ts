import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { Database } from "bun:sqlite";
import * as schema from "./schema";

const sqlite = new Database("indiesearch.db");
export let db = drizzle(sqlite, { schema: schema });

export function hash(image: any): any {
	return Bun.hash(image.toString());
}

export function retrieveAllButtons() {
	try {
		return db.query.buttons.findMany();
	} catch (error) {
		return false;
	}
}

export async function insertButton(button: schema.Button) {
	try {
		console.log(await db.insert(schema.buttons).values(button).returning());
		console.log("Inserted button: " + button.src);
		return true;
	} catch (error) {
		// If error is due to unique constraint (button already exists)
		console.log(
			"Button already exists, adding website relation: " + button.src
		);
		try {
			const existingButton = await db.query.buttons.findFirst({
				where: eq(schema.buttons.src, button.src),
			});

			if (existingButton) {
				if (button.website_id) {
					await db.insert(schema.buttonWebsiteRelations).values({
						button_id: existingButton.id,
						website_id: button.website_id,
					});
					console.log("Added relation for existing button");
				} else {
					console.log("Button exists but no website_id provided");
				}
				return true;
			}
		} catch (innerError) {
			console.error("Failed to create relation:", innerError);
		}
		console.error("Error inserting button:", error);
		return false;
	}
}

export function retrieveAllScrapedURLs() {
	try {
		return db.query.scrapedURLs.findMany();
	} catch (error) {
		return {};
	}
}

export async function retrieveURLsToScrape() {
	try {
		return await db.query.scrapedURLs.findMany({
			where: eq(schema.scrapedURLs.scraped, false),
		});
	} catch (error) {
		return [];
	}
}

export async function scrapedURL(url: string) {
	try {
		await db
			.update(schema.scrapedURLs)
			.set({ scraped: true, scraped_date: new Date().getTime() })
			.where(eq(schema.scrapedURLs.url, url));
		console.log("Scraped URL:", url);
		return true;
	} catch (error) {
		console.log("Already Scraped.");
		return false;
	}
}

export async function addURLToScrape(url: string) {
	try {
		// Check if URL already exists in database
		const existing = await db.query.scrapedURLs.findFirst({
			where: eq(schema.scrapedURLs.url, url),
		});

		if (existing) {
			await db
				.update(schema.scrapedURLs)
				.set({ scraped: false })
				.where(eq(schema.scrapedURLs.url, url));
			return true;
		}

		const returning = await db
			.insert(schema.scrapedURLs)
			.values({ url: url, hash: hash(url), scraped: false });
		console.log("Added URL to scrape: " + url);
		return returning;
	} catch (error) {
		console.error(error);
		return false;
	}
}
