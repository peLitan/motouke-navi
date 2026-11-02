// 画面の書き出し(F05e・F11d が使う)
// 文字列をファイルとして保存させる。Blob とリンクの download を使うだけで、外へは送らない
export function downloadText(doc, text, fileName, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = fileName;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
