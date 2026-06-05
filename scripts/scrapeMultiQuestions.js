const puppeteer = require('puppeteer');

// The main search results index URL you provided
// MUST RUN FROM ANOTHER TERMINAL: "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --user-data-dir="C:\edge-dev-profile"
const SEARCH_INDEX_URL = 'https://gmatclub.com/forum/search.php?selected_search_tags%5B%5D=1533&selected_search_tags%5B%5D=187&selected_search_tags%5B%5D=52&selected_search_tags%5B%5D=57&t=0&search_tags=exact&submit=Search';
// const SEARCH_INDEX_URL = 'https://gmatclub.com/forum/search.php?view=search_tags';

async function runScoutingCrawler() {
    let browser;
    try {
        console.log('🔌 Connecting to running Edge browser on port 9222...');
        browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });

        const targetPage = await browser.newPage();
        await targetPage.setViewport({ width: 1280, height: 800 });

        console.log('🌐 Loading search results index page...');
        await targetPage.goto(SEARCH_INDEX_URL, { waitUntil: 'networkidle2', timeout: 60000 });

        console.log('🕵️‍♂️ Scanning search page rows for valid question URLs...');
        const questionUrls = await targetPage.evaluate(() => {
            const mainContainer = document.querySelector('#page-body') || document;
            const rows = Array.from(mainContainer.querySelectorAll('a'));

            return rows
                .map(link => link.href)
                .filter(href => {
                    if (!href) return false;
                    const urlStr = href.toLowerCase();
                    const isForumTopic = urlStr.includes('gmatclub.com/forum/') && urlStr.endsWith('.html');
                    const isClutter =
                        urlStr.includes('gmat-math-book') ||
                        urlStr.includes('downloadable-pdf') ||
                        urlStr.includes('all-you-need') ||
                        urlStr.includes('directory') ||
                        urlStr.includes('search.php') ||
                        urlStr.includes('view=');

                    return isForumTopic && !isClutter;
                })
                .filter((value, index, self) => self.indexOf(value) === index);
        });

        console.log(`🎯 Found ${questionUrls.length} targeted paths to evaluate.`);
        await targetPage.close();

        if (questionUrls.length === 0) return;

        // Process a robust test batch of 10 items
        const targetLinksToCrawl = questionUrls.slice(24, 40);
        const locallyCapturedBank = [];

        for (let i = 0; i < targetLinksToCrawl.length; i++) {
            const url = targetLinksToCrawl[i];
            console.log(`\n🚙 [${i + 1}/${targetLinksToCrawl.length}] Processing layout at: ${url}`);

            const currentTab = await browser.newPage();
            try {
                await currentTab.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
                await currentTab.evaluate(() => new Promise(resolve => setTimeout(resolve, 2000)));

                // Read the whole body plain text to dodge CSS selector shifts entirely
                const fullPageRawText = await currentTab.evaluate(() => document.body.innerText);

                const parsedData = parseRawTextToSchema(fullPageRawText);

                if (parsedData) {
                    locallyCapturedBank.push(parsedData);
                    console.log(`✅ Cleanly Extracted: "${parsedData.questionText.substring(0, 45)}..."`);
                } else {
                    console.log('⚠️ Skipped: Could not build a validated 5-option schema object from raw layout text.');
                }

            } catch (tabError) {
                console.error(`❌ Frame thread error: ${tabError.message}`);
            } finally {
                await currentTab.close();
            }
        }

        console.log('\n================🚀 SCOUTING CRAWLER LIVE BATCH REPORT 🚀================');
        console.log(`📋 Total clean objects captured during this run: ${locallyCapturedBank.length}\n`);
        console.log(JSON.stringify(locallyCapturedBank, null, 2));
        console.log('========================================================================\n');

    } catch (error) {
        console.error('❌ Root System Execution Error:', error.message);
    } finally {
        if (browser) await browser.disconnect();
    }
}

function parseRawTextToSchema(fullBodyText) {
    // 1. Normalize spacing to avoid variable tab/line break interference
    const cleanBody = fullBodyText.replace(/\s+/g, ' ');

    // 2. Identify the true core question start token
    const matchQuestion = cleanBody.match(/(?:If|From the|What is|Which of|In a room|How many)\s[^]*?(?=\b[A-E]\)|[A-E]\.|\([A-E]\))/i);
    if (!matchQuestion) return null;

    const startIndex = cleanBody.indexOf(matchQuestion[0]);
    if (startIndex === -1) return null;

    // Grab a focused 2000-character snapshot window right where the problem lives
    const sampleTextWindow = cleanBody.substring(startIndex, startIndex + 2000);

    // 3. Pinpoint the exact starting positions of the 5 option markers in the string window
    const markerPatterns = [
        /(?:\s|^)(A)(?:\.|\)|\s)/,
        /(?:\s|^)(B)(?:\.|\)|\s)/,
        /(?:\s|^)(C)(?:\.|\)|\s)/,
        /(?:\s|^)(D)(?:\.|\)|\s)/,
        /(?:\s|^)(E)(?:\.|\)|\s)/
    ];

    const markerIndices = [];
    let lastFoundIdx = 0;

    for (let i = 0; i < markerPatterns.length; i++) {
        // Look forward from the last marker to ensure correct algebraic A->B->C->D->E sequence
        const searchSubstr = sampleTextWindow.substring(lastFoundIdx);
        const match = searchSubstr.match(markerPatterns[i]);

        if (!match) return null; // If any option marker is completely absent, reject this malformed block

        const absoluteIdx = lastFoundIdx + match.index;
        markerIndices.push({
            letter: match[1],
            start: absoluteIdx,
            end: absoluteIdx + match[0].length
        });

        lastFoundIdx = absoluteIdx + match[0].length;
    }

    // 4. Extract Question Text (Everything up to Option A marker)
    let questionTextStr = sampleTextWindow.substring(0, markerIndices[0].start).trim();

    // Aggressively slice out forum meta-clutter if it managed to slip into the question text block
    questionTextStr = questionTextStr
        .split(/(\d{3}-\d{3}\s*\(Hard\))/i)[0] // Drops "655-705 (Hard)..."
        .split('Show Answer')[0]
        .split('Source')[0]
        .split('⏱️')[0]
        .trim();

    // 5. Slice Option Strings cleanly using the boundary coordinates of the next marker
    const optionsArray = [];
    for (let i = 0; i < 5; i++) {
        const currentMarker = markerIndices[i];
        // If it's option E, capture up to the end of a reasonable string chunk window
        const nextMarkerStart = (i < 4) ? markerIndices[i + 1].start : currentMarker.end + 150;

        let optionRawValue = sampleTextWindow.substring(currentMarker.end, nextMarkerStart).trim();

        // Strip away trailing noise leak fragments if we are evaluating Option E
        if (i === 4) {
            optionRawValue = optionRawValue
                .split('Show Answer')[0]
                .split('Source')[0]
                .split('Most Active')[0]
                .split('⏱️')[0]
                .split('Discuss')[0]
                .trim();
        }

        if (optionRawValue.length === 0) return null;
        optionsArray.push(optionRawValue);
    }

    // Final Structural Verification Check
    if (optionsArray.length !== 5 || questionTextStr.length < 15) {
        return null;
    }

    return {
        questionText: questionTextStr,
        options: optionsArray,
        correctOptionIndex: 4, // Seed placeholder mapping coordinates
        subject: 'Quantitative',
        chapter: 'Arithmetic'
    };
}

runScoutingCrawler();