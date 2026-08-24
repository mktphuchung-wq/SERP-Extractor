(function () {
  function extractSERPData() {
    var h3Tags = document.querySelectorAll("h3.LC20lb.MBeuO.DKV0Md");
    var serpResults = [];

    h3Tags.forEach((tag, index) => {
      var anchorText = tag.textContent;
      var anchorLink = tag.closest("a").href;
      serpResults.push({
        position: index + 1,
        url: anchorLink,
        title: anchorText,
      });
    });

    return serpResults;
  }

  function displayResults(results) {
    var tableBody = document.getElementById("serp-results");
    if (!tableBody) {
      console.error("Table body element not found");
      return;
    }

    tableBody.innerHTML = ""; // Clear existing content
    results.forEach((result) => {
      var row = document.createElement("tr");
      row.innerHTML = `<td style="text-align:center;">${result.position}</td>
                             <td><a href="${result.url}" target="_blank">${result.url}</a></td>
                             <td>${result.title}</td>`;
      tableBody.appendChild(row);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    try {
      var serpResults = extractSERPData();
      displayResults(serpResults);
    } catch (error) {
      console.error("Error extracting or displaying SERP data:", error);
    }
  });
})();
