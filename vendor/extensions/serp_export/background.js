chrome.action.onClicked.addListener((tab) => { 
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractSERPAndPAAData,
  }, (results) => {
    chrome.tabs.create({ url: chrome.runtime.getURL('results.html') }, (newTab) => {
      chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
        if (tabId === newTab.id && changeInfo.status === 'complete') {
          chrome.tabs.sendMessage(newTab.id, { extractedData: results[0].result });
          chrome.tabs.onUpdated.removeListener(listener);
        }
      });
    });
  });
});

function extractSERPAndPAAData() {
  let serpResults = [];
  let paaResults = [];
  let seenQuestions = new Set();
  let paaUrls = new Set();

  // Extract SERP results
  let h3Tags = document.querySelectorAll('h3.LC20lb.MBeuO.DKV0Md');
  h3Tags.forEach((tag, index) => {
    let anchor = tag.closest('a');
    if (anchor) {
      let url = anchor.href;
      if (!url.includes('#:~:text=')) {
        serpResults.push({
          position: index + 1,
          url: url,
          title: tag.textContent.trim()
        });
      }
    }
  });

  // Extract PAA results
  let paaContainers = document.querySelectorAll("div[jscontroller]");
  paaContainers.forEach((container, index) => {
    let questionEl = container.querySelector("span.CSkcDe");
    let answerEl = container.querySelector("span.hgKElc");

    if (questionEl && answerEl) {
      let questionText = questionEl.innerText.trim();
      let answerText = answerEl.innerText.trim();
      let url = "";

      let linkEl = answerEl.closest("a");
      if (linkEl) {
        url = linkEl.href;
      }

      if (!url) {
        let questionLinkEl = questionEl.closest("a");
        if (questionLinkEl) {
          url = questionLinkEl.href;
        }
      }

      if (!url) {
        let parentLinkEl = container.querySelector('a');
        if (parentLinkEl) {
          url = parentLinkEl.href;
        }
      }

      if (url) {
        paaUrls.add(url);
      }

      if (!seenQuestions.has(questionText)) {
        seenQuestions.add(questionText);
        paaResults.push({
          question: questionText,
          answer: answerText,
          url: url || 'N/A'
        });
      }
    }
  });

  return { serpResults, paaResults };
}
