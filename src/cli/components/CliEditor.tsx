import { useEffect } from 'react';
import { render } from 'ink';
import { MarkdownEditor } from '../../components/MarkdownEditor.js';
import { editorStore } from '../../stores/editorStore.js';
import { navigationStore } from '../../stores/navigationStore.js';

/**
 * Opens the internal markdown editor in the CLI for a given content string.
 * Returns the edited content on save, or the original content on cancel.
 */
export function openCliEditor(content: string): Promise<string> {
  return new Promise<string>((resolve) => {
    let saved = false;

    editorStore.getState().init(content, {
      returnScreen: 'list',
      onSave: (edited: string) => {
        saved = true;
        resolve(edited);
      },
    });
    navigationStore.getState().navigate('editor');

    function ExitWatcher() {
      const screen = navigationStore.getState().screen;
      useEffect(() => {
        return navigationStore.subscribe((state) => {
          if (state.screen !== 'editor') {
            instance.unmount();
            if (!saved) resolve(content);
          }
        });
      }, []);
      // Only render the editor when on the editor screen
      if (screen === 'editor') return <MarkdownEditor />;
      return null;
    }

    const instance = render(<ExitWatcher />);
  });
}
