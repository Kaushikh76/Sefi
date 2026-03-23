function isDigit(char) {
  return char >= '0' && char <= '9';
}

function isIntegerToken(token) {
  return /^-?(0|[1-9]\d*)$/.test(token);
}

function isUnsafeIntegerToken(token) {
  try {
    const value = BigInt(token);
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
    return value > maxSafe || value < minSafe;
  } catch {
    return false;
  }
}

function quoteUnsafeIntegers(jsonText) {
  let output = '';
  let index = 0;
  let inString = false;
  let escaped = false;

  while (index < jsonText.length) {
    const char = jsonText[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      index += 1;
      continue;
    }

    const startsNumber = char === '-' || isDigit(char);
    if (!startsNumber) {
      output += char;
      index += 1;
      continue;
    }

    const numberStart = index;
    index += 1;
    while (index < jsonText.length) {
      const part = jsonText[index];
      if (isDigit(part) || part === '.' || part === 'e' || part === 'E' || part === '+' || part === '-') {
        index += 1;
      } else {
        break;
      }
    }

    const token = jsonText.slice(numberStart, index);
    if (isIntegerToken(token) && isUnsafeIntegerToken(token)) {
      output += `"${token}"`;
    } else {
      output += token;
    }
  }

  return output;
}

export function parseJsonLosslessInt64(jsonText) {
  const input = String(jsonText ?? '');
  if (!input.trim()) {
    return null;
  }
  const transformed = quoteUnsafeIntegers(input);
  return JSON.parse(transformed);
}

