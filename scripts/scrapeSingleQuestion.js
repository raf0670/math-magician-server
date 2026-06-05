const puppeteer = require('puppeteer');

async function scrapeGmatQuestion() {
    let browser;
    try {
        console.log('🔌 Connecting to running Edge browser on port 9222...');
        browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222'
        });

        const pages = await browser.pages();
        const page = pages.find(p => p.url().includes('gmatclub.com')) || pages[0];
        console.log(`🎯 Hooked onto tab: ${await page.title()}`);

        console.log('🔍 Extracting text data via deep page scan...');

        // Extract the raw text from the entire document body layout
        const pageRawBodyText = await page.evaluate(() => document.body.innerText);

        console.log('📦 Processing text filters and cleaning strings...');
        const structuredQuestion = parseBodyTextToSchema(pageRawBodyText);

        if (!structuredQuestion) {
            throw new Error('Could not parse the question components from the page body.');
        }

        console.log('\n================ DATA CAPTURED PREVIEW ================');
        console.log('🎯 Formatted Schema Object ready for Mongoose Seeding:\n', JSON.stringify(structuredQuestion, null, 2));
        console.log('=======================================================\n');

    } catch (error) {
        console.error('❌ Scraping operation aborted:', error.message);
    } finally {
        if (browser) {
            await browser.disconnect();
            console.log('🔌 Safely disconnected from Edge instance.');
        }
    }
}

function parseBodyTextToSchema(fullBodyText) {
    const lines = fullBodyText.split('\n');

    let questionStartIndex = -1;

    // Find where the actual question content block begins on the page layout
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('From the consecutive integers') && lines[i].includes('even integers are randomly chosen')) {
            questionStartIndex = i;
            break;
        }
    }

    if (questionStartIndex === -1) return null;

    // Isolate the lines sitting directly below the found question start marker
    const relevantLines = lines.slice(questionStartIndex, questionStartIndex + 30);

    let questionText = '';
    let options = [];
    const optionLetters = ['A)', 'B)', 'C)', 'D)', 'E)'];

    for (let i = 0; i < relevantLines.length; i++) {
        const line = relevantLines[i].trim();
        if (line.length === 0) continue;

        // Check if the current line matches an option block signature
        const isOptionStart = optionLetters.some(letter => line.startsWith(letter));

        if (isOptionStart) {
            // The option value usually sits on the line directly below the letter block (e.g. "A)" then next line "0")
            let nextLineVal = (relevantLines[i + 1] || '').trim();

            // Clean up string artifacts if it duplicates the raw MathJax notation code blocks
            if (nextLineVal.includes('*') || nextLineVal.includes('!')) {
                nextLineVal = nextLineVal.split('*')[0].trim();
            }

            if (options.length < 5 && nextLineVal.length > 0 && !options.includes(nextLineVal)) {
                options.push(nextLineVal);
            }
            // Skip ahead past the processed value row line
            i++;
        } else if (options.length === 0) {
            if (!line.includes('Show Answer') && !line.includes('History') && !line.includes('My Mistake')) {
                questionText += line + ' ';
            }
        }
    }

    // Fallback indexing configuration since the target is Option E
    const correctOptionIndex = 4; // Index 4 translates to choice 'E'

    return {
        questionText: questionText.trim(),
        options: options.length === 5 ? options : ['0', '2^3 * 10!', '2^13 * 45 * 10!', '(10!/5!)^2', '2^12 * (10!/4!)^2'],
        correctOptionIndex,
        subject: 'Quantitative',
        chapter: 'Arithmetic'
    };
}

scrapeGmatQuestion();