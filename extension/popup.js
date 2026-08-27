chrome.runtime.sendMessage({ type: 'status' }, (res) => {
  const el = document.getElementById('state');
  const hint = document.getElementById('hint');
  if (res?.connected) {
    el.textContent = 'dang ket noi';
    el.className = 'badge on';
    hint.textContent = res.tabs.length
      ? `Dang dieu khien ${res.tabs.length} tab do tool mo.`
      : 'San sang. Tool chua mo tab nao.';
  } else {
    el.textContent = 'chua ket noi';
    el.className = 'badge off';
  }
});
