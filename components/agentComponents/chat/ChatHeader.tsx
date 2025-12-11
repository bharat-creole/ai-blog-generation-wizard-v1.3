import React from 'react';
import bloggrLogo from '../../assets/Bloggr-Logo.png'

function ChatHeader() {
  return (
    <div className="flex flex-col items-center justify-center  py-[44px] ">
     
        <img src={bloggrLogo} alt="Bloggr Logo" className="" />
    
      <div className="text-sm font-medium text-black mt-[5px]">Bloggr Agent</div>
      <div className="w-full border-b border-lightgray mt-[44px]" />
    </div>
  );
}

export default ChatHeader;