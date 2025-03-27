const puppeteer = require("puppeteer");
import * as db from "./db/db";
import * as bcrypt from "bcryptjs";

declare var self: Worker;

function scrapeEntireWebsite(url: string) {
    console.log("Scraping: " + url);
    puppeteer.launch({headless: 'shell'}).then(async (browser: any) => {
        const page = await browser.newPage();
        await page.goto(url);
        const buttons = await page.evaluate(() => {
            const buttons = [];
            let elements = page.querySelectorAll("img");
            for (let element of elements) {
                if (element.src && element.width == 88 && element.height == 31) {
                    buttons.push(element.src);
                }
            }
            return buttons;
        });
        console.log(buttons);
        await browser.close();
    });
}
    

self.onmessage = (event: MessageEvent) => {
    if (event.data.url) {
        scrapeEntireWebsite(event.data.url);
    }
};