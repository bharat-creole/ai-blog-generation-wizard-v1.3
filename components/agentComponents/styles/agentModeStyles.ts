import React from 'react';

/**
 * AgentMode Component Styles
 * Contains all CSS styles used in the AgentMode component
 */

// Markdown preview styles
export const markdownStyles = `
	/* Thin scrollbars - visible only on hover/scroll */
	* {
		scrollbar-width: thin;
		scrollbar-color: transparent transparent;
		transition: scrollbar-color 0.3s ease;
	}
	
	*:hover {
		scrollbar-color: rgba(156, 163, 175, 0.3) transparent;
	}
	
	*::-webkit-scrollbar {
		width: 3px;
		height: 3px;
	}
	
	*::-webkit-scrollbar-track {
		background: transparent;
	}
	
	*::-webkit-scrollbar-thumb {
		background: transparent;
		border-radius: 10px;
		transition: background 0.3s ease;
	}
	
	*:hover::-webkit-scrollbar-thumb {
		background: rgba(156, 163, 175, 0.3);
	}
	
	*::-webkit-scrollbar-thumb:hover {
		background: rgba(156, 163, 175, 0.5);
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateX(20px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}
	.markdown-preview .markdown-content h1 {
		font-size: 2rem;
		font-weight: bold;
		margin-bottom: 1rem;
		color: #1a1a1a;
	}
	.markdown-preview .markdown-content h2 {
		font-size: 1.5rem;
		font-weight: bold;
		margin-top: 1.5rem;
		margin-bottom: 0.75rem;
		color: #2d3748;
	}
	.markdown-preview .markdown-content h3 {
		font-size: 1.25rem;
		font-weight: 600;
		margin-top: 1rem;
		margin-bottom: 0.5rem;
		color: #4a5568;
	}
	.markdown-preview .markdown-content p {
		margin-bottom: 0.75rem;
		color: #4a5568;
		line-height: 1.7;
	}
	.markdown-preview .markdown-content ul,
	.markdown-preview .markdown-content ol {
		margin-left: 1.5rem;
		margin-bottom: 0.75rem;
		list-style-position: outside;
	}
	.markdown-preview .markdown-content ul {
		list-style-type: disc;
	}
	.markdown-preview .markdown-content ol {
		list-style-type: decimal;
	}
	.markdown-preview .markdown-content li {
		margin-bottom: 0.25rem;
		color: #4a5568;
	}
	.markdown-preview .markdown-content a {
		color: #2563eb;
		text-decoration: underline;
	}
	.markdown-preview .markdown-content a:hover {
		color: #1d4ed8;
	}
	.markdown-preview .markdown-content blockquote {
		border-left: 4px solid #cbd5e0;
		padding-left: 1rem;
		font-style: italic;
		margin: 1rem 0;
		color: #718096;
	}
	.markdown-preview .markdown-content code {
		background-color: #f7fafc;
		padding: 0.125rem 0.25rem;
		border-radius: 0.25rem;
		font-size: 0.875rem;
		font-family: monospace;
	}
	.markdown-preview .markdown-content pre {
		background-color: #f7fafc;
		padding: 1rem;
		border-radius: 0.5rem;
		overflow-x: auto;
		margin: 1rem 0;
	}
	.markdown-preview .markdown-content table {
		width: 100%;
		border-collapse: collapse;
		margin: 1rem 0;
		display: table;
		border-spacing: 0;
		overflow-x: auto;
	}
	.markdown-preview .markdown-content thead {
		display: table-header-group;
	}
	.markdown-preview .markdown-content tbody {
		display: table-row-group;
	}
	.markdown-preview .markdown-content tr {
		display: table-row;
		border-top: 1px solid #cbd5e0;
	}
	.markdown-preview .markdown-content th,
	.markdown-preview .markdown-content td {
		border: 1px solid #cbd5e0;
		padding: 0.75rem 1rem;
		display: table-cell;
		text-align: left;
		vertical-align: top;
	}
	.markdown-preview .markdown-content th {
		background-color: #f7fafc;
		font-weight: 600;
		text-align: left;
	}
	.markdown-preview .markdown-content tbody tr:nth-child(even) {
		background-color: #f9fafb;
	}
	.markdown-preview .markdown-content tbody tr:hover {
		background-color: #f3f4f6;
	}
	.markdown-preview .markdown-content strong {
		font-weight: 700;
	}
	.markdown-preview .markdown-content em {
		font-style: italic;
	}
`;

// Inline style objects for React components
export const inputTextareaStyles: React.CSSProperties = {
	minHeight: '24px',
	maxHeight: '200px',
};
