function copyToClipboard(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
}

document.addEventListener('DOMContentLoaded', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {message: "get_suggestions"}, function(response) {
            if (chrome.runtime.lastError || !response) {
                document.getElementById('suggestionsBox').innerText = 'No suggestions available or wrong page.';
                return;
            }

            let suggestions = response.suggestions;
            let container = document.getElementById('suggestionsBox');
            suggestions.forEach(suggestion => {
                let li = document.createElement('li');
                li.classList.add('list-group-item');
                li.innerText = suggestion;
                li.onclick = () => copyToClipboard(suggestion);
                container.appendChild(li);
            });
        });
    });

    document.getElementById('copyAll').addEventListener('click', function() {
        let allSuggestions = Array.from(document.querySelectorAll('.list-group-item'))
                                .map(item => item.innerText)
                                .join('\n');
        copyToClipboard(allSuggestions);
    });
});
