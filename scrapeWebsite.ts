import * as db from "./db/db";
import { imageSize } from "image-size";
import { sleep } from "bun";
import * as cheerio from "cheerio";

declare var self: Worker;

console.log("Worker started");

export type Button = {
	id?: number;
	image: any;
	filename: string;
	scraped_date: Date | null;
	found_url: string;
	hash: string;
	src: string;
	links_to?: string | null;
	website_id?: number | null;
  };

function getImageSize(buffer: Buffer): { width: number; height: number } {
	const metadata = imageSize(buffer);
	return { width: metadata.width || 0, height: metadata.height || 0 };
}

function fetchButton(url: string): Promise<Response> {
	return fetch(url);
}

async function scrapeSinglePath(path: string): Promise<Button[]> {
	try {
		let totalButtonData: Button[] = [];
		const response = await fetch(path);
		if (!response.ok) {
			postMessage({ success: false, error: "Failed to fetch the URL" });
			console.error("error: ", response.statusText);
			process.exit();
		}
		const $ = cheerio.load(await response.text());
		const images = $("img").toArray();
		console.log("Found " + images.length + " images on the page");
		for (const element of images) {
			console.log("Scraping image number " + images.indexOf(element) + " of " + images.length);
			if (!$(element).attr("src")) continue;

			var src = $(element).attr("src") as any;
			if (src && !src.startsWith("http")) {
				src = new URL(src, path).href;
			}

			let links_to = null;
			const parentAnchor = $(element).closest("a");
			if (parentAnchor.length > 0 && parentAnchor.attr("href")) {
				const href = parentAnchor.attr("href")!;
				try {
					if (!href.startsWith("http://") && !href.startsWith("https://")) {
						if (href.startsWith("/")) {
							links_to = new URL(href, path).href;
						} else {
							links_to = `https://${href}`;
						}
					} else {
						links_to = href;
					}
				} catch (error) {
					console.log("Invalid URL:", href, error);
					links_to = href; // Keep the original href as a fallback
				}
			}

			if (!src) continue;
			let button = await fetchButton(src);

			if (!button.ok) {
				console.log("Failed to fetch image:", src);
				continue;
			}

			let buttonBuffer = Buffer.from(await button.arrayBuffer());

			if (buttonBuffer.length === 0) {
				console.log("Empty image buffer for:", src);
				continue;
			}

			try {
				const { width, height } = getImageSize(buttonBuffer);
				if (!(width === 88 && height === 31)) {
					continue;
				}
			} catch (error) {
				continue;
			}

			const filename = $(element).attr("src") as string;
			const scraped_date = await new Date();
			const found_url = path;
			const hash = db.hash(buttonBuffer) as string;

			// Check if this button is already in totalButtonData
			if (totalButtonData.some((btn) => btn.hash === hash)) {
				console.log("Already have this button:", filename);
				continue;
			}

			const buttonData: Button = {
				image: buttonBuffer,
				filename: filename,  
				scraped_date: scraped_date ,
				found_url: found_url,
				hash: hash,
				src: src,
				links_to,
			};

			totalButtonData.push(buttonData);

			// Mark the URL as scraped only after successfully adding the button data
			await db.scrapedURLPath(new URL(path).pathname);
		}

		return totalButtonData;
	} catch (error) {
		console.error("Error scraping:", error);
		postMessage({ success: false, error: "Scraping failed" });
		process.exit();
	}
}

function scrapeEntireWebsite(url: string): Promise<Button[]> {
	return new Promise(async (resolve, reject) => {
		try {
			if (!url.startsWith("http://") && !url.startsWith("https://")) {
				url = "https://" + url;
				url = new URL(url).href;
			}
			const response = await fetch(url);
			
			if (!response.ok) {
				postMessage({ success: false, error: "Failed to fetch the URL" });
				process.exit();
			}

			const $ = cheerio.load(await response.text());
			const links = $("a").toArray();
			console.log("Found " + links.length + " links on the page");

			
			// Helper function to prioritize links
			function getPriorityScore(link: any, $: any): number {
				const href = $(link).attr('href') || '';
				const text = $(link).text().toLowerCase();
				const classes = $(link).attr('class') || '';
				const id = $(link).attr('id') || '';
				
				// Check if link contains priority keywords
				if (href.includes('button') || href.includes('link') || href.includes('out')) {
					return 10;
				}
				if (text.includes('button') || text.includes('link') || text.includes('out')) {
					return 8;
				}
				if (classes.includes('button') || classes.includes('link') || classes.includes('out')) {
					return 6;
				}
				if (id.includes('button') || id.includes('link') || id.includes('out')) {
					return 4;
				}
				return 0;
			}

			// Sort links by priority score
			const prioritizedLinks = [...links].sort((a, b) => 
				getPriorityScore(b, $) - getPriorityScore(a, $)
			);

			const website = new URL(url);
			const baseUrl = website.origin;
			const visited = new Set<string>();
			const toVisit = new Set<string>();
			let totalButtonData: Button[] = [];

			// Add initial page to the queue
			toVisit.add(website.pathname);

			// Process all links in the page to normalize them and add to queue
			for (const link of prioritizedLinks) {
				const href = $(link).attr('href');
				if (!href) continue;
				
				try {
					let normalizedHref: string;
					
					// Handle different link formats
					if (href.startsWith('/')) {
						// Already a relative path starting with /
						normalizedHref = href;
					} else if (href.startsWith('#')) {
						// Skip anchors on the same page
						continue;
					} else if (href.startsWith('http://') || href.startsWith('https://')) {
						// Check if it's from the same origin
						const linkUrl = new URL(href);
						if (linkUrl.origin !== baseUrl) continue;
						normalizedHref = linkUrl.pathname + linkUrl.search + linkUrl.hash;
					} else if (!href.startsWith('mailto:') && !href.startsWith('tel:')) {
						// Assume it's a relative path not starting with /
						normalizedHref = '/' + href;
					} else {
						// Skip non-http links
						continue;
					}
					
					toVisit.add(normalizedHref);
				} catch (error) {
					console.log("Invalid URL:", href);
				}
			}

			// Process pages in queue
			while (toVisit.size > 0) {
				const path = Array.from(toVisit)[0];
				if (!path) break;
				toVisit.delete(path);
				
				if (visited.has(path)) continue;
				visited.add(path);
				
				// Check if URL was already scraped
				const isScraped = await db.isURLScraped(path);
				if (isScraped) {
					console.log("Already scraped:", path);
					continue;
				}
				
				console.log("Scraping:", baseUrl + path);
				try {
					const buttons = await scrapeSinglePath(baseUrl + path);
					totalButtonData = [...totalButtonData, ...buttons];
					
					// Throttle requests to avoid overloading the server
					await sleep(1000);
				} catch (error) {
					console.error("Error scraping path:", path, error);
				}
			}

			resolve(totalButtonData);
		} catch (error) {
			console.error("Error in scrapeEntireWebsite:", error);
			reject(error);
			process.exit();
		}
	});
}

self.onmessage = async (event: MessageEvent) => {
	console.log("url received " + event.data.url)
	const totalButtonData = await scrapeEntireWebsite(event.data.url);
	for (const button of totalButtonData) {
		db.insertButton(button, (await db.retrieveURLId(event.data.url)) as number);
	}	
	postMessage({ buttonData: totalButtonData, success: true });
	process.exit();
};