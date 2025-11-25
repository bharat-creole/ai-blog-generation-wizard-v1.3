import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

interface StreamingTextProps {
	text: string;
	speed?: number; // milliseconds per character
	onComplete?: () => void;
}

const StreamingText: React.FC<StreamingTextProps> = ({
	text,
	speed = 20,
	onComplete,
}) => {
	const [displayedText, setDisplayedText] = useState('');
	const [currentIndex, setCurrentIndex] = useState(0);

	useEffect(() => {
		if (currentIndex < text.length) {
			const timeout = setTimeout(() => {
				setDisplayedText((prev) => prev + text[currentIndex]);
				setCurrentIndex((prev) => prev + 1);
			}, speed);

			return () => clearTimeout(timeout);
		} else if (currentIndex === text.length && onComplete) {
			onComplete();
		}
	}, [currentIndex, text, speed, onComplete]);

	// Reset when text changes
	useEffect(() => {
		setDisplayedText('');
		setCurrentIndex(0);
	}, [text]);

	return (
		<div className="prose prose-sm max-w-none">
			<ReactMarkdown>
				{displayedText + (currentIndex < text.length ? '▍' : '')}
			</ReactMarkdown>
		</div>
	);
};

export default StreamingText;
