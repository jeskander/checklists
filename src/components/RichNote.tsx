import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { useEffect, useRef, useMemo } from 'react'
import { debounce } from '../lib/debounce'
import './RichNote.css'

type Props = {
  content: string | undefined
  onChange: (json: string) => void
  placeholder?: string
}

function parseNoteContent(content: string | undefined) {
  if (!content) return undefined
  try {
    return JSON.parse(content)
  } catch {
    return undefined
  }
}

function noteContentKey(content: string | undefined): string {
  if (!content) return ''
  try {
    return JSON.stringify(JSON.parse(content))
  } catch {
    return content
  }
}

export function RichNote({ content, onChange, placeholder = 'Notes…' }: Props) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const lastSavedKey = useRef(noteContentKey(content))
  const lastAppliedKey = useRef(noteContentKey(content))

  const debouncedSave = useMemo(
    () =>
      debounce((json: string) => {
        lastSavedKey.current = noteContentKey(json)
        onChangeRef.current(json)
      }, 500),
    []
  )

  const editor = useEditor({
    extensions: [StarterKit, Underline],
    content: parseNoteContent(content),
    editorProps: {
      attributes: { class: 'rich-note-editor' },
    },
    onUpdate: ({ editor: e }) => {
      debouncedSave(JSON.stringify(e.getJSON()))
    },
    onBlur: ({ editor: e }) => {
      debouncedSave.flush()
      const json = JSON.stringify(e.getJSON())
      lastSavedKey.current = noteContentKey(json)
    },
  })

  useEffect(() => {
    return () => debouncedSave.cancel()
  }, [debouncedSave])

  useEffect(() => {
    if (!editor) return
    if (editor.isFocused) return

    const incomingKey = noteContentKey(content)
    if (incomingKey === lastAppliedKey.current) return
    if (incomingKey === lastSavedKey.current) {
      lastAppliedKey.current = incomingKey
      return
    }

    lastAppliedKey.current = incomingKey
    lastSavedKey.current = incomingKey
    const doc = parseNoteContent(content)
    if (doc) {
      editor.commands.setContent(doc, { emitUpdate: false })
    } else {
      editor.commands.clearContent(false)
    }
  }, [content, editor])

  if (!editor) return null

  return (
    <div className="rich-note">
      <div className="rich-note-toolbar">
        <button
          type="button"
          className={editor.isActive('bold') ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          B
        </button>
        <button
          type="button"
          className={editor.isActive('italic') ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          I
        </button>
        <button
          type="button"
          className={editor.isActive('underline') ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          U
        </button>
      </div>
      <EditorContent editor={editor} />
      {!editor.getText().trim() && <span className="rich-note-placeholder">{placeholder}</span>}
    </div>
  )
}
