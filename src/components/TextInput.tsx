/**
 * Drop-in replacement for ink-text-input with readline shortcuts and
 * proper forward-delete support.
 *
 * Enhancements over ink-text-input:
 * - Ctrl+A / Home: move cursor to start
 * - Ctrl+E / End: move cursor to end
 * - Ctrl+W: delete word backward
 * - Ctrl+K: kill to end of line
 * - Ctrl+U: kill to start of line
 * - Ctrl+D: forward delete (alternative)
 * - Alt+B / Ctrl+Left: word left
 * - Alt+F / Ctrl+Right: word right
 * - Delete key: forward delete (distinguished from Backspace via raw stdin)
 */
import { useState, useEffect } from 'react';
import { Text, useInput } from 'ink';
import chalk from 'chalk';
import { useForwardDelete } from '../hooks/useForwardDelete.js';

interface TextInputProps {
  value: string;
  placeholder?: string;
  focus?: boolean;
  mask?: string;
  showCursor?: boolean;
  highlightPastedText?: boolean;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
}

function TextInput({
  value: originalValue,
  placeholder = '',
  focus = true,
  mask,
  highlightPastedText = false,
  showCursor = true,
  onChange,
  onSubmit,
}: TextInputProps) {
  const [state, setState] = useState({
    cursorOffset: (originalValue || '').length,
    cursorWidth: 0,
  });

  const { cursorOffset, cursorWidth } = state;
  const isForwardDeleteRef = useForwardDelete(focus);

  useEffect(() => {
    setState((previousState) => {
      if (!focus || !showCursor) {
        return previousState;
      }

      const newValue = originalValue || '';
      if (previousState.cursorOffset > newValue.length - 1) {
        return {
          cursorOffset: newValue.length,
          cursorWidth: 0,
        };
      }

      return previousState;
    });
  }, [originalValue, focus, showCursor]);

  const cursorActualWidth = highlightPastedText ? cursorWidth : 0;
  const value = mask ? mask.repeat(originalValue.length) : originalValue;
  let renderedValue = value;
  let renderedPlaceholder = placeholder ? chalk.grey(placeholder) : undefined;

  if (showCursor && focus) {
    renderedPlaceholder =
      placeholder.length > 0
        ? chalk.inverse(placeholder[0]) + chalk.grey(placeholder.slice(1))
        : chalk.inverse(' ');

    renderedValue = value.length > 0 ? '' : chalk.inverse(' ');

    let i = 0;
    for (const char of value) {
      renderedValue +=
        i >= cursorOffset - cursorActualWidth && i <= cursorOffset
          ? chalk.inverse(char)
          : char;
      i++;
    }

    if (value.length > 0 && cursorOffset === value.length) {
      renderedValue += chalk.inverse(' ');
    }
  }

  useInput(
    (input, key) => {
      if (
        key.upArrow ||
        key.downArrow ||
        (key.ctrl && input === 'c') ||
        key.tab ||
        (key.shift && key.tab)
      ) {
        return;
      }

      if (key.return) {
        if (onSubmit) {
          onSubmit(originalValue);
        }

        return;
      }

      let nextCursorOffset = cursorOffset;
      let nextValue = originalValue;
      let nextCursorWidth = 0;

      // Home / Ctrl+A — move cursor to start
      if (key.home || (input === 'a' && key.ctrl)) {
        setState({ cursorOffset: 0, cursorWidth: 0 });
        return;
      }

      // End / Ctrl+E — move cursor to end
      if (key.end || (input === 'e' && key.ctrl)) {
        setState({ cursorOffset: originalValue.length, cursorWidth: 0 });
        return;
      }

      // Word left: Alt+B or Ctrl+Left
      if (
        (input === 'b' && key.meta) ||
        (key.leftArrow && (key.ctrl || key.meta))
      ) {
        let i = cursorOffset;
        while (i > 0 && originalValue[i - 1] === ' ') i--;
        while (i > 0 && originalValue[i - 1] !== ' ') i--;
        setState({ cursorOffset: i, cursorWidth: 0 });
        return;
      }

      // Word right: Alt+F or Ctrl+Right
      if (
        (input === 'f' && key.meta) ||
        (key.rightArrow && (key.ctrl || key.meta))
      ) {
        let i = cursorOffset;
        while (i < originalValue.length && originalValue[i] !== ' ') i++;
        while (i < originalValue.length && originalValue[i] === ' ') i++;
        setState({ cursorOffset: i, cursorWidth: 0 });
        return;
      }

      // Ctrl+W — delete word backward
      if (input === 'w' && key.ctrl) {
        let i = cursorOffset;
        while (i > 0 && originalValue[i - 1] === ' ') i--;
        while (i > 0 && originalValue[i - 1] !== ' ') i--;
        nextValue =
          originalValue.slice(0, i) + originalValue.slice(cursorOffset);
        nextCursorOffset = i;
      }
      // Ctrl+K — kill to end of line
      else if (input === 'k' && key.ctrl) {
        nextValue = originalValue.slice(0, cursorOffset);
      }
      // Ctrl+U — kill to start of line
      else if (input === 'u' && key.ctrl) {
        nextValue = originalValue.slice(cursorOffset);
        nextCursorOffset = 0;
      }
      // Ctrl+D — forward delete
      else if (input === 'd' && key.ctrl) {
        if (cursorOffset < originalValue.length) {
          nextValue =
            originalValue.slice(0, cursorOffset) +
            originalValue.slice(cursorOffset + 1);
        }
      }
      // Left arrow
      else if (key.leftArrow) {
        if (showCursor) {
          nextCursorOffset--;
        }
      }
      // Right arrow
      else if (key.rightArrow) {
        if (showCursor) {
          nextCursorOffset++;
        }
      }
      // Backspace / Delete key
      else if (key.backspace || key.delete) {
        if (isForwardDeleteRef.current) {
          // Forward delete (physical Delete key)
          isForwardDeleteRef.current = false;
          if (cursorOffset < originalValue.length) {
            nextValue =
              originalValue.slice(0, cursorOffset) +
              originalValue.slice(cursorOffset + 1);
          }
        } else {
          // Backward delete (physical Backspace key)
          if (cursorOffset > 0) {
            nextValue =
              originalValue.slice(0, cursorOffset - 1) +
              originalValue.slice(cursorOffset);
            nextCursorOffset--;
          }
        }
      }
      // Regular character input
      else {
        nextValue =
          originalValue.slice(0, cursorOffset) +
          input +
          originalValue.slice(cursorOffset);
        nextCursorOffset += input.length;
        if (input.length > 1) {
          nextCursorWidth = input.length;
        }
      }

      if (cursorOffset < 0) {
        nextCursorOffset = 0;
      }

      if (cursorOffset > originalValue.length) {
        nextCursorOffset = originalValue.length;
      }

      setState({
        cursorOffset: nextCursorOffset,
        cursorWidth: nextCursorWidth,
      });

      if (nextValue !== originalValue) {
        onChange(nextValue);
      }
    },
    { isActive: focus },
  );

  return (
    <Text>
      {placeholder
        ? value.length > 0
          ? renderedValue
          : renderedPlaceholder
        : renderedValue}
    </Text>
  );
}

export default TextInput;
