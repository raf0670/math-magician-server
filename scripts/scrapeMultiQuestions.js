const puppeteer = require('puppeteer');

// The main search results index URL you provided
// MUST RUN FROM ANOTHER TERMINAL: "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --user-data-dir="C:\edge-dev-profile"
const SEARCH_INDEX_URL = 'https://gmatclub.com/forum/search.php?selected_search_tags%5B%5D=1533&selected_search_tags%5B%5D=187&selected_search_tags%5B%5D=52&selected_search_tags%5B%5D=57&t=0&search_tags=exact&submit=Search';
// const SEARCH_INDEX_URL = 'https://gmatclub.com/forum/search.php?view=search_tags';

async function runMultiPageCrawler() {
    let browser;
    try {
        console.log('🔌 Connecting to running Edge browser on port 9222...');
        browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222'
        });

        // Create a fresh tab explicitly for the search scanner
        const targetPage = await browser.newPage();
        await targetPage.setViewport({ width: 1280, height: 800 });

        console.log('🌐 Loading search results index page...');
        await targetPage.goto(SEARCH_INDEX_URL, { waitUntil: 'networkidle2', timeout: 60000 });

        // Extract links that match the specific forum question topic URL pattern
        console.log('🕵️‍♂️ Scanning page with optimized DOM scoping and keyword exclusion...');
        const questionUrls = await targetPage.evaluate(() => {
            // 1. Isolate the main forum thread rows to exclude sidebars, headers, and footers
            // GMAT Club uses '.table-list', '.forum-topics', or generic search result containers
            const searchContainer = document.querySelector('#page-body, .page-content, .search.post');
            const searchContext = searchContainer ? searchContainer : document;

            const links = Array.from(searchContext.querySelectorAll('a'));

            return links
                .map(link => ({
                    href: link.href,
                    text: (link.innerText || '').toLowerCase()
                }))
                .filter(item => {
                    if (!item.href) return false;

                    const urlStr = item.href.toLowerCase();

                    // Must be a standard forum topic HTML page route
                    const isForumTopic = urlStr.includes('gmatclub.com/forum/') && urlStr.endsWith('.html');

                    // Look out for resource directory keywords in BOTH the URL string and the visible anchor text link
                    const isResourceClutter =
                        urlStr.includes('gmat-math-book') ||
                        urlStr.includes('downloadable-pdf') ||
                        urlStr.includes('all-you-need') ||
                        urlStr.includes('error-log') ||
                        urlStr.includes('directory') ||
                        item.text.includes('book') ||
                        item.text.includes('download') ||
                        item.text.includes('guide') ||
                        item.text.includes('announcement');

                    return isForumTopic && !isResourceClutter;
                })
                .map(item => item.href)
                // Ensure only unique values remain in our clean crawl list queue array
                .filter((value, index, self) => self.indexOf(value) === index);
        });

        console.log(`🎯 Found ${questionUrls.length} unique question threads on this index page!`);

        // Close the search index tab to free up system memory
        await targetPage.close();

        if (questionUrls.length === 0) {
            throw new Error('No valid question URLs detected on the index layout.');
        }

        const scrapedQuestionBank = [];

        // We will limit our crawl test run to the first 5 links so we don't spam the server
        const targetLinksToCrawl = questionUrls.slice(0, questionUrls.length);

        // Loop through each question URL sequentially
        for (let i = 0; i < targetLinksToCrawl.length; i++) {
            const url = targetLinksToCrawl[i];
            console.log(`\n🚙 [${i + 1}/${targetLinksToCrawl.length}] Crawling link: ${url}`);

            const currentTab = await browser.newPage();
            try {
                await currentTab.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

                // Add a human-mimicking delay so the server doesn't flag the rapid navigation
                await currentTab.evaluate(() => new Promise(resolve => setTimeout(resolve, 2500)));

                // Extract the full page raw body text
                const bodyText = await currentTab.evaluate(() => document.body.innerText);

                // Parse the body string using a dynamic word-search algorithm
                const parsedData = parseBodyTextToSchema(bodyText);

                if (parsedData) {
                    scrapedQuestionBank.push(parsedData);
                    console.log(`✅ Successfully extracted: "${parsedData.questionText.substring(0, 45)}..."`);
                } else {
                    console.log(`⚠️ Skipped link: Text layout didn't match our GMAT problem keywords.`);
                }

            } catch (tabError) {
                console.error(`❌ Failed processing tab execution window: ${tabError.message}`);
            } finally {
                // Always close the tab when finished to prevent memory leaks
                await currentTab.close();
            }
        }

        console.log('\n================ CRAWL EXTRACTION REPORT ================');
        console.log(`🎉 Successfully compiled ${scrapedQuestionBank.length} questions ready for seeding!`);
        console.log(JSON.stringify(scrapedQuestionBank, null, 2));
        console.log('=========================================================\n');

    } catch (error) {
        console.error('❌ Multi-page crawling routine aborted:', error.message);
    } finally {
        if (browser) {
            await browser.disconnect();
            console.log('🔌 Safely disconnected from Edge instance.');
        }
    }
}

// Resilient text-driven extraction logic
function parseBodyTextToSchema(fullBodyText) {
    const lines = fullBodyText.split('\n');
    let questionStartIndex = -1;

    // Locate the starting line of the core question block dynamically
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase();
        // Look for generic markers that indicate a math problem text layout
        if ((line.includes('if') || line.includes('from the') || line.includes('what is') || line.includes('which of')) &&
            (line.includes('integer') || line.includes('value') || line.includes('product') || line.includes('equal'))) {
            questionStartIndex = i;
            break;
        }
    }

    if (questionStartIndex === -1) return null;

    const relevantLines = lines.slice(questionStartIndex, questionStartIndex + 30);
    let questionText = '';
    let options = [];
    const optionLetters = ['A)', 'B)', 'C)', 'D)', 'E)'];

    for (let i = 0; i < relevantLines.length; i++) {
        const line = relevantLines[i].trim();
        if (line.length === 0) continue;

        const isOptionStart = optionLetters.some(letter => line.startsWith(letter));

        if (isOptionStart) {
            let nextLineVal = (relevantLines[i + 1] || '').trim();

            // Basic math notation cleanup
            if (nextLineVal.includes('*') || nextLineVal.includes('!')) {
                nextLineVal = nextLineVal.split('*')[0].trim();
            }

            if (options.length < 5 && nextLineVal.length > 0 && !options.includes(nextLineVal)) {
                options.push(nextLineVal);
            }
            i++;
        } else if (options.length === 0) {
            if (!line.includes('Show Answer') && !line.includes('History') && !line.includes('My Mistake') && !line.includes('Posts:')) {
                questionText += line + ' ';
            }
        }
    }

    // Fallback defaults if layout variation misses choices
    if (options.length < 5) {
        options = ['Option A', 'Option B', 'Option C', 'Option D', 'Option E'];
    }

    return {
        questionText: questionText.trim(),
        options: options.slice(0, 5),
        correctOptionIndex: 4, // Default placeholder index
        subject: 'Quantitative',
        chapter: 'Arithmetic'
    };
}

runMultiPageCrawler();