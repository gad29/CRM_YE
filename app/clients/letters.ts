/** Avatar letters from the words that start with a letter: "לקוח 1 כהן" → "לכ". */
export function letters(name: string) {
  const words = name.trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  if (words.length === 0) return name.trim().slice(0, 1) || '·';
  return words.length === 1 ? words[0][0] : words[0][0] + words[words.length - 1][0];
}
