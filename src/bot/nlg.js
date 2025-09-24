
export function renderTemplate(tpl, data) {
  return (tpl || '').replace(/\{\{(.*?)\}\}/g, (_, key) => {
    const k = key.trim();
    return data[k] ?? '';
  });
}
