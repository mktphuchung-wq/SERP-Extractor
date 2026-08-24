function extractGoogleSearchSuggestions() {
    const suggestions = [];
    const suggestionElements = document.querySelectorAll('.erkvQe .sbct');

    suggestionElements.forEach((element) => {
        const textElement = element.querySelector('.wM6W7d');
        if (textElement) {
            suggestions.push(textElement.innerText);
        }
    });

    return suggestions;
}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.message === "get_suggestions") {
        let suggestions = extractGoogleSearchSuggestions();
        sendResponse({ suggestions: suggestions || [] });
    }
    return true; // keep the message channel open for asynchronous response
});
