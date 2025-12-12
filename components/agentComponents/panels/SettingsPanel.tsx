import React from 'react';
import { BlogData } from '../../../types';

interface SettingsPanelProps {
    show: boolean;
    data: BlogData;
    updateData: (data: Partial<BlogData>) => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ show, data, updateData }) => {
    if (!show) return null;

    return (
        <div className='mb-4 flex-shrink-0'>
            <div className='p-4 border-2 border-blue-500 rounded-lg bg-white text-sm shadow-lg'>
                <div className='space-y-4'>
                    <div>
                        <h3 className='font-bold text-gray-800 mb-3'>⚙️ Settings</h3>
                        <div className='space-y-3'>
                            <div>
                                <label htmlFor='agent-apiKey' className='block text-sm font-medium text-gray-700 mb-1'>
                                    Gemini API Key (Optional)
                                </label>
                                <input
                                    type='password'
                                    id='agent-apiKey'
                                    value={data.apiKey}
                                    onChange={(e) => updateData({ apiKey: e.target.value })}
                                    className='w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500 text-sm'
                                    placeholder='Enter your Gemini API key (optional)'
                                />
                                <p className='text-xs text-gray-500 mt-1'>
                                    Your API key is stored only in your browser for this session. If not provided, the server will use GEMINI_API_KEY from .env file.
                                </p>
                            </div>
                            {data.apiKey && (
                                <div className='text-xs text-green-600'>
                                    ✓ API key is configured (will override server .env setting)
                                </div>
                            )}
                            {!data.apiKey && (
                                <div className='text-xs text-gray-600'>
                                    ℹ️ Using server-configured API key from .env file
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsPanel;
