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

	// Handle undefined or null text
	const safeText = text || '';

	useEffect(() => {
		if (currentIndex < safeText.length) {
			const timeout = setTimeout(() => {
				setDisplayedText((prev) => prev + safeText[currentIndex]);
				setCurrentIndex((prev) => prev + 1);
			}, speed);

			return () => clearTimeout(timeout);
		} else if (currentIndex === safeText.length && onComplete) {
			onComplete();
		}
	}, [currentIndex, safeText, speed, onComplete]);

	// Reset when text changes
	useEffect(() => {
		setDisplayedText('');
		setCurrentIndex(0);
	}, [safeText]);

	return (
		<div className="prose prose-sm max-w-none">
			<ReactMarkdown>
				{displayedText + (currentIndex < safeText.length ? '▍' : '')}
			</ReactMarkdown>
		</div>
	);
};

export default StreamingText;
