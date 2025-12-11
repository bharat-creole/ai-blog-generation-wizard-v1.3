import React from 'react'
import logo from '../components/assets/Bloggr.ai.svg'
import BlogCountIcon from '../components/assets/blogcount.svg';
import regeneration from '../components/assets/regenerate.svg';
import plagiarism from '../components/assets/plagiarism.svg'
import { getEnvironmentConfig } from './config';

function AppHeader() {
    const config = getEnvironmentConfig();

    const onLogoClick = () => {
        window.location.href = config.URL;
    }
    const onBlogCountClick = () => {
        window.location.href = config.BLOG_COUNT_URL;
    }
    const onRegenerationClick = () => {
        window.location.href = config.REGENERATION_URL;
    }
    const onPlagiarismClick = () => {
        window.location.href = config.PLAGIARISM_URL;
    }
    return (
        <header className="flex items-center justify-between px-[20px] py-[14px] bg-white z-50 relative shadow-[0_2px_20px_rgba(34,34,34,0.1)]">
            {/* Left: Logo/Brand */}
            <img src={logo} alt='logo' className='cursor-pointer' onClick={onLogoClick}/>
            {/* Right: Icons/Notifications */}
            <div className="flex items-center gap-[30px]">
                {/* Example icon with badge */}
                <img width={25} height={25} src={BlogCountIcon} alt='logo' className='cursor-pointer' onClick={onBlogCountClick}/>
                <img src={regeneration} alt='logo' className='cursor-pointer' onClick={onRegenerationClick}/>
                <img src={plagiarism} alt='logo' className='cursor-pointer' onClick={onPlagiarismClick}/>
            </div>
        </header>
    )
}

export default AppHeader