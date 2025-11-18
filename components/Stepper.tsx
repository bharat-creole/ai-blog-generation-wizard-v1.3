
import React from 'react';
import { AppStep, BlogData } from '../types';
import { STEPS } from '../constants';
import { CheckCircleIcon, DocumentTextIcon, LinkIcon, PencilSquareIcon, SparklesIcon, Bars3BottomLeftIcon, RocketLaunchIcon } from './icons';

interface StepperProps {
    currentStep: AppStep;
    blogData: BlogData;
}

const getStepStatus = (stepId: AppStep, currentStep: AppStep) => {
    if (stepId < currentStep) return 'completed';
    if (stepId === currentStep) return 'current';
    return 'pending';
};

const getStepSummary = (stepId: AppStep, data: BlogData): string => {
    switch (stepId) {
        case AppStep.Title:
            return data.title || 'Set Title';
        case AppStep.ReferenceArticles:
            return `${data.referenceUrls.length} URLs, ${data.referenceFiles.length} File${data.referenceFiles.length !== 1 ? 's' : ''}`;
        case AppStep.Interlinking:
            return `${data.interlinks.length} Interlink${data.interlinks.length !== 1 ? 's' : ''}`;
        case AppStep.WritingStyle:
            return `${data.llmModel}, ${data.language}`;
        default:
            return '';
    }
};

const ICONS: { [key in AppStep]: React.FC<React.SVGProps<SVGSVGElement>> } = {
    [AppStep.Title]: PencilSquareIcon,
    [AppStep.ReferenceArticles]: DocumentTextIcon,
    [AppStep.Interlinking]: LinkIcon,
    [AppStep.WritingStyle]: SparklesIcon,
    [AppStep.ReviewOutline]: Bars3BottomLeftIcon,
    [AppStep.YourBlogIsReady]: RocketLaunchIcon,
};


const Stepper: React.FC<StepperProps> = ({ currentStep, blogData }) => {
    return (
        <aside className="w-full md:w-80 bg-gray-50 p-6 md:p-8 border-b md:border-b-0 md:border-r border-gray-200">
            <nav>
                <ul className="space-y-4">
                    {STEPS.map((step, index) => {
                        const status = getStepStatus(step.id, currentStep);
                        const summary = getStepSummary(step.id, blogData);
                        const Icon = ICONS[step.id];

                        return (
                            <li key={step.id}>
                                <div
                                    className={`p-4 rounded-lg border-2 transition-all duration-300 ${
                                        status === 'current' ? 'border-orange-500 bg-orange-50' :
                                        status === 'completed' ? 'border-green-500 bg-white' :
                                        'border-gray-200 bg-white'
                                    }`}
                                >
                                    <div className="flex items-center space-x-3">
                                        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                                            status === 'current' ? 'bg-orange-500 text-white' :
                                            status === 'completed' ? 'bg-green-500 text-white' :
                                            'bg-gray-200 text-gray-500'
                                        }`}>
                                            {status === 'completed' ? <CheckCircleIcon className="w-5 h-5" /> : <span className="font-bold">{index + 1}</span>}
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-semibold text-gray-800">{step.title}</h3>
                                            {summary && <p className="text-xs text-gray-500 truncate">{summary}</p>}
                                        </div>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </nav>
        </aside>
    );
};

export default Stepper;
