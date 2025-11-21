
import React from 'react';

interface SpinnerProps {
    className?: string;
}

const Spinner: React.FC<SpinnerProps> = ({ className = '' }) => {
    const defaultClasses = "animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500";
    const combinedClasses = className ? `${defaultClasses} ${className}` : defaultClasses;
    
    return (
        <div className={combinedClasses}></div>
    );
};

export default Spinner;
