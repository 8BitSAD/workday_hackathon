// "One Thing" browser extension to help users focus on one button at a time.

// Step 1. We gather the candidates that will be scored and ranked.
// get all clickable elements on the page
const clickableElements = document.querySelectorAll('a, button, input[type="button"], input[type="submit"], .button, [onclick]');

// Step 2. We score the different candidates and the higher will be more likely to be the "One Thing"
function scoreElement(e) {
    let score = 0;
    const text = (el.innerText || '').toLowerCase();
    const aria = el.getAttribute('aria-lable') || '';
    const combined = text + ' ' + aria;

    // primary action keywords (weighted highest)
    const primaryKeywords = ['submit', 'save', 'continue', 'next', 'proceed', 'confirm', 'send', 
        'checkout', 'pay', 'buy', 'purchase', 'book', 'reserve', , 'create', 'home'];
    for (let word of primaryKeywords) {
        if (combined.includes(word)) {
            score += 10;
        }
    }

    // secondary action keywords (important but lower weight)
    const secondaryKeywords = ['login', 'sign in', 'learn more', 'details', 'info', 'view', 'explore', 
        'try', 'demo', 'download', 'register', 'add to cart', 'upload'];
    for (let word of secondaryKeywords) {
        if (combined.includes(word)) {
            score += 5;
        }
    }

    // negative indicators
    const negativeKeywords = ['close', 'cancel', 'dismiss', 'hide', 'remove', 'delete', 'back',
        'previous'];
    for (let word of negativeKeywords) {
        if (combined.includes(word)) {
            score -= 20;
        }
    }

    // visual prominence
    const rect = el.getBoundingClientRect();
    if (rect.width > 100) {
        score += 2;
    }
    if (rect.height > 30) {
        score += 1;
    }

    // check for primary buttons
    if (el.classList.contains('primary')) {
        score += 15;
    }
    if (el.classList.contains('btn-primary')) {
        score += 15;
    }
    if (el.classList.contains('data-primary') === 'true') {
        score += 15;
    }

    return score;
}

// Step 3. We rank and pick the highest score out of the candidates
let bestElement = null;
let bestScore = -Infinity;

for (let el of clickables) {
    let score = scoreElement(el);
    if (score > bestScore) {
        bestScore = score;
        bestElement = el;
    }
}

if (bestScore < 5) {
    // we want to show a searchbox instad of guessing
}