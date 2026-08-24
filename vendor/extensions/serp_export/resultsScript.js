document.addEventListener("DOMContentLoaded", () => {
  let serpResults = [];
  let paaResults = [];

  chrome.runtime.onMessage.addListener((message) => {
    if (message.extractedData) {
      serpResults = message.extractedData.serpResults;
      paaResults = message.extractedData.paaResults;
      displaySERPResults(serpResults);
      displayPAAResults(paaResults);
    } else {
      displayFeedback("No data received.");
    }
  });

  // Tab switching functionality
  document.getElementById("serp-tab").addEventListener("click", () => {
    document.getElementById("serp-container").style.display = "block";
    document.getElementById("paa-container").style.display = "none";
    toggleExportButton("serp");
  });

  document.getElementById("paa-tab").addEventListener("click", () => {
    document.getElementById("serp-container").style.display = "none";
    document.getElementById("paa-container").style.display = "block";
    toggleExportButton("paa");
  });

  // Display SERP Results
  function displaySERPResults(results) {
    const tableBody = document.getElementById("serp-results");
    tableBody.innerHTML = ""; // Clear existing content

    // Reset position count
    let positionCount = 1;

    results.forEach((result) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td style="text-align:center;">${positionCount}</td>
                     <td><a href="${result.url}" target="_blank">${result.url}</a></td>
                     <td>${result.title}</td>`;
      tableBody.appendChild(row);

      // Increment position count after each result
      positionCount++;
    });
  }

  // Display PAA Results
  function displayPAAResults(results) {
    const tableBody = document.getElementById("paa-results");
    tableBody.innerHTML = "";
    results.forEach((result, index) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td style="text-align:center;">${index + 1}</td>
                     <td>${result.question}</td>
                     <td>${result.answer}</td>
                     <td id="link-source"><a href="${
                       result.url !== "N/A" ? result.url : "#"
                     }" target="_blank">Source</a></td>`;
      tableBody.appendChild(row);
    });
  }
  // Search functionality
  document.getElementById("search-input").addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase();
    filterResults(query);
  });

  function filterResults(query) {
    const rows = document.querySelectorAll("#serp-results tr");
    rows.forEach((row) => {
      const url = row
        .querySelector("td:nth-child(2)")
        .textContent.toLowerCase();
      row.style.display = url.includes(query) ? "" : "none";
    });
  }

  // Export SERP data as CSV
  document.getElementById("export-serp-btn")?.addEventListener("click", () => {
    if (serpResults.length > 0) {
      exportSERPToCSV(serpResults);
    } else {
      alert("No SERP data available to export.");
    }
  });

  // Export PAA data as CSV
  document.getElementById("export-paa-btn")?.addEventListener("click", () => {
    if (paaResults.length > 0) {
      exportPAAToCSV(paaResults);
    } else {
      alert("No PAA data available to export.");
    }
  });

  function wrapTextWithQuotes(text) {
    if (text && (text.includes(",") || text.includes('"'))) {
      return `"${text.replace(/"/g, '""')}"`; // Escape existing quotes and wrap in double quotes
    }
    return text;
  }

  function exportSERPToCSV(serpData) {
    const csvRows = [];
    csvRows.push("Position,URL,Title"); // Header for SERP
    serpData.forEach((result) => {
      csvRows.push(
        `${result.position},${wrapTextWithQuotes(
          result.url
        )},${wrapTextWithQuotes(result.title)}`
      );
    });

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "SERP_Results.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPAAToCSV(paaData) {
    const csvRows = [];
    csvRows.push("Question,Answer,Link"); // Header for PAA (using 'Link' instead of 'Source')

    paaData.forEach((result) => {
      // Instead of showing the URL, display "Link" as the value in the 'Link' column
      csvRows.push(`${result.question},${result.answer},Link`);
    });

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "PAA_Results.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Toggle visibility of export buttons based on the active tab
  function toggleExportButton(activeTab) {
    if (activeTab === "serp") {
      document.getElementById("export-serp-btn").style.display = "inline-block";
      document.getElementById("export-paa-btn").style.display = "none";
    } else if (activeTab === "paa") {
      document.getElementById("export-serp-btn").style.display = "none";
      document.getElementById("export-paa-btn").style.display = "inline-block";
    }
  }

  // Ensure the SERP export button is visible by default
  toggleExportButton("serp");

  function displayFeedback(message) {
    const feedback = document.getElementById("feedback");
    feedback.textContent = message;
    setTimeout(() => (feedback.textContent = ""), 3000);
  }
});
