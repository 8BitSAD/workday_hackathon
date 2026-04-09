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
        'checkout', 'pay', 'buy', 'purchase', 'book', 'reserve', 'back', 'cancel', 'create', 'home'];
    for (let word of primaryKeywords) {
        if (combined.includes(word)) {
            score += 10;
        }
    }
}

// Step 3. We rank and pick the highest score out of the candidates 