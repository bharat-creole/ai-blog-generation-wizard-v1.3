import React, { useState } from 'react';
import {
	DndContext,
	closestCenter,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	DragEndEvent,
	DragStartEvent,
	DragOverlay,
} from '@dnd-kit/core';
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { OutlineSection, OutlineItem } from '../../../types';
import { GripVertical, Plus, Trash2, Edit2,plusIcon, Check, X,EditIcon,DeleteIcon,DragHandleIcon, PlusIcon2} from '../../../components/icons';


interface DraggableOutlineProps {
	outline: OutlineSection[];
	onOutlineChange: (newOutline: OutlineSection[]) => void;
}

interface SortableH2Props {
	section: OutlineSection;
	index: number;
	onDeleteH2: (id: string) => void;
	onEditH2: (id: string, newName: string) => void;
	onAddH3: (sectionId: string, h3Name: string) => void;
	onDeleteH3: (sectionId: string, h3Id: string) => void;
	onEditH3: (sectionId: string, h3Id: string, newName: string) => void;
	onReorderH3: (
		sectionId: string,
		oldIndex: number,
		newIndex: number
	) => void;
}

// Limits for headings
const H2_MAX = 10;
const H3_MAX = 7;

const SortableH3Item: React.FC<{
	item: OutlineItem;
	sectionId: string;
	onDelete: (sectionId: string, itemId: string) => void;
	onEdit: (sectionId: string, itemId: string, newName: string) => void;
}> = ({ item, sectionId, onDelete, onEdit }) => {
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(item.name);

	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: item.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	const handleSave = () => {
		if (editValue.trim()) {
			onEdit(sectionId, item.id, editValue.trim());
			setIsEditing(false);
		}
	};

	const handleCancel = () => {
		setEditValue(item.name);
		setIsEditing(false);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			handleSave();
		} else if (e.key === 'Escape') {
			handleCancel();
		}
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			className='flex items-center gap-[10px] text-xs py-1.5 px-2 bg-offwhite rounded-[8px]  hover:bg-gray-100 '
		>
			<div
				{...attributes}
				{...listeners}
				className='cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600'
				tabIndex={0}
				aria-label='Drag to reorder H3'
			>
				<DragHandleIcon />
			</div>

			{isEditing ? (
				<>
					<input
						type='text'
						value={editValue}
						onChange={(e) =>
							setEditValue(e.target.value)
						}
						onKeyDown={handleKeyDown}
						className='flex-1 px-2 py-1 text-xs border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500'
						autoFocus
						aria-label='Edit H3 heading'
					/>
					<button
						onClick={handleSave}
						className='p-1 text-green-600 hover:text-green-700 transition-colors'
						aria-label='Save changes'
						tabIndex={0}
					>
						<Check className='w-3 h-3' />
					</button>
					<button
						onClick={handleCancel}
						className='p-1 text-gray-500 hover:text-gray-600 transition-colors'
						aria-label='Cancel editing'
						tabIndex={0}
					>
						<X className='w-3 h-3' />
					</button>
				</>
			) : (
				<>
					<span className='flex-1 text-sm font-normal text-black'>{item.name}</span>
					<div className='flex gap-[9px]  group-hover:opacity-100 transition-opacity'>
						<button
							onClick={() => setIsEditing(true)}
							className=''
							aria-label='Edit H3'
							tabIndex={0}
						>
							<EditIcon />
						</button>
						<button
							onClick={() =>
								onDelete(sectionId, item.id)
							}
							className='p-1 text-red-500 hover:text-red-600 transition-colors'
							aria-label='Delete H3'
							tabIndex={0}
						>
							<DeleteIcon className='w-3 h-3' />
						</button>
					</div>
				</>
			)}
		</div>
	);
};

const SortableH2Item: React.FC<SortableH2Props> = ({
	section,
	index,
	onDeleteH2,
	onEditH2,
	onAddH3,
	onDeleteH3,
	onEditH3,
	onReorderH3,
}) => {
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(section.name);
	const [isAddingH3, setIsAddingH3] = useState(false);
	const [newH3Value, setNewH3Value] = useState('');

	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: section.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		})
	);

	const handleSave = () => {
		if (editValue.trim()) {
			onEditH2(section.id, editValue.trim());
			setIsEditing(false);
		}
	};

	const handleCancel = () => {
		setEditValue(section.name);
		setIsEditing(false);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			handleSave();
		} else if (e.key === 'Escape') {
			handleCancel();
		}
	};

	const handleAddH3 = () => {
		if (newH3Value.trim()) {
			// Check H3 limit (7 per H2 section)
			if (section.items.length >= H3_MAX) {
				alert(
					`Maximum ${H3_MAX} H3 headings allowed per H2 section. Please remove an existing H3 before adding a new one.`
				);
				return;
			}
			onAddH3(section.id, newH3Value.trim());
			setNewH3Value('');
			setIsAddingH3(false);
		}
	};

	const handleH3KeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			handleAddH3();
		} else if (e.key === 'Escape') {
			setNewH3Value('');
			setIsAddingH3(false);
		}
	};

	const handleH3DragEnd = (event: DragEndEvent) => {
		const { active, over } = event;

		if (over && active.id !== over.id) {
			const oldIndex = section.items.findIndex(
				(item) => item.id === active.id
			);
			const newIndex = section.items.findIndex(
				(item) => item.id === over.id
			);
			onReorderH3(section.id, oldIndex, newIndex);
		}
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			className='border-l-2 border-l-lightgray pl-3'
		>
			<div className='flex items-center  px-[15px] py-[8px] gap-[10px] mb-[14px] bg-[#DBE5F1] rounded-[8px]'>
				<div
					{...attributes}
					{...listeners}
					className='cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600'
					tabIndex={0}
					aria-label='Drag to reorder H2'
				>
					<DragHandleIcon />
				</div>

				{isEditing ? (
					<>
						<input
							type='text'
							value={editValue}
							onChange={(e) =>
								setEditValue(e.target.value)
							}
							onKeyDown={handleKeyDown}
							className='flex-1 px-3 py-1.5 text-sm font-semibold border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500'
							autoFocus
							aria-label='Edit H2 heading'
						/>
						<button
							onClick={handleSave}
							className='p-1.5 text-green-600 hover:text-green-700 transition-colors'
							aria-label='Save changes'
							tabIndex={0}
						>
							<Check className='w-4 h-4' />
						</button>
						<button
							onClick={handleCancel}
							className='p-1.5 text-gray-500 hover:text-gray-600 transition-colors'
							aria-label='Cancel editing'
							tabIndex={0}
						>
							<X className='w-4 h-4' />
						</button>
					</>
				) : (
					<>
						<span className='flex-1 text-base font-medium text-black'>
							{index + 1}. {section.name}
						</span>
						<div className='flex gap-[9px]  group-hover:opacity-100 transition-opacity'>
							<button
								onClick={() => setIsEditing(true)}
								className=''
								aria-label='Edit H2'
								tabIndex={0}
							>
								<EditIcon />
							</button>
							<button
								onClick={() => onDeleteH2(section.id)}
								className=''
								aria-label='Delete H2'
								tabIndex={0}
							>
								<DeleteIcon/>
							</button>
						</div>
					</>
				)}
			</div>

			{section.items && section.items.length > 0 && (
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragEnd={handleH3DragEnd}
				>
					<SortableContext
						items={section.items.map((item) => item.id)}
						strategy={verticalListSortingStrategy}
					>
						<div className='ml-[10px] space-y-[4px]'>
							{section.items.map((item) => (
								<SortableH3Item
									key={item.id}
									item={item}
									sectionId={section.id}
									onDelete={onDeleteH3}
									onEdit={onEditH3}
								/>
							))}
						</div>
					</SortableContext>
				</DndContext>
			)}

			{/* Add H3 Form */}
			<div className='ml-[10px] mt-[4px]'>
				{isAddingH3 ? (
					<div className='flex items-center gap-2'>
						<input
							type='text'
							value={newH3Value}
							onChange={(e) =>
								setNewH3Value(e.target.value)
							}
							onKeyDown={handleH3KeyDown}
							placeholder='Enter H3 heading...'
							className='flex-1 px-2 py-1.5 text-xs border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500'
							autoFocus
							aria-label='New H3 heading'
						/>
						<button
							onClick={handleAddH3}
							disabled={
								section.items.length >= H3_MAX
							}
							className='px-2 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed disabled:text-gray-500'
							aria-label='Add H3'
							tabIndex={0}
						>
							Add
						</button>
						<button
							onClick={() => {
								setIsAddingH3(false);
								setNewH3Value('');
							}}
							className='px-2 py-1.5 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition-colors'
							aria-label='Cancel'
							tabIndex={0}
						>
							Cancel
						</button>
					</div>
				) : (
					<button
						onClick={() => setIsAddingH3(true)}
						className='flex items-center gap-2 px-[10px] py-[7.5px] text-sm font-medium text-primary  justify-center bg-offwhite'
						tabIndex={0}
						title={
							section.items.length >= H3_MAX
								? `Maximum ${H3_MAX} H3 headings per section`
								: 'Add H3 heading'
						}
					>
						<PlusIcon2/>
						Add H3
					</button>
				)}
			</div>
		</div>
	);
};

const DraggableOutline: React.FC<DraggableOutlineProps> = ({
	outline,
	onOutlineChange,
}) => {
	const [activeId, setActiveId] = useState<string | null>(null);
	const [isAddingH2, setIsAddingH2] = useState(false);
	const [newH2Value, setNewH2Value] = useState('');

	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		})
	);

	const handleDragStart = (event: DragStartEvent) => {
		setActiveId(event.active.id as string);
	};

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;

		if (over && active.id !== over.id) {
			const oldIndex = outline.findIndex(
				(section) => section.id === active.id
			);
			const newIndex = outline.findIndex(
				(section) => section.id === over.id
			);

			const newOutline = arrayMove(outline, oldIndex, newIndex);
			onOutlineChange(newOutline);
		}

		setActiveId(null);
	};

	const handleAddH2 = () => {
		if (newH2Value.trim()) {
			// Check H2 limit (10 total)
			if (outline.length >= H2_MAX) {
				alert(
					`Maximum ${H2_MAX} H2 headings allowed. Please remove an existing H2 before adding a new one.`
				);
				return;
			}
			const newSection: OutlineSection = {
				id: `h2-${Date.now()}`,
				name: newH2Value.trim(),
				items: [],
			};
			onOutlineChange([...outline, newSection]);
			setNewH2Value('');
			setIsAddingH2(false);
		}
	};

	const handleH2KeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			handleAddH2();
		} else if (e.key === 'Escape') {
			setNewH2Value('');
			setIsAddingH2(false);
		}
	};

	const handleDeleteH2 = (id: string) => {
		const newOutline = outline.filter((section) => section.id !== id);
		onOutlineChange(newOutline);
	};

	const handleEditH2 = (id: string, newName: string) => {
		const newOutline = outline.map((section) =>
			section.id === id ? { ...section, name: newName } : section
		);
		onOutlineChange(newOutline);
	};

	const handleAddH3 = (sectionId: string, h3Name: string) => {
		const newOutline = outline.map((section) => {
			if (section.id === sectionId) {
				const newItem: OutlineItem = {
					id: `h3-${Date.now()}`,
					name: h3Name,
				};
				return {
					...section,
					items: [...(section.items || []), newItem],
				};
			}
			return section;
		});
		onOutlineChange(newOutline);
	};

	const handleDeleteH3 = (sectionId: string, h3Id: string) => {
		const newOutline = outline.map((section) => {
			if (section.id === sectionId) {
				return {
					...section,
					items: section.items.filter(
						(item) => item.id !== h3Id
					),
				};
			}
			return section;
		});
		onOutlineChange(newOutline);
	};

	const handleEditH3 = (
		sectionId: string,
		h3Id: string,
		newName: string
	) => {
		const newOutline = outline.map((section) => {
			if (section.id === sectionId) {
				return {
					...section,
					items: section.items.map((item) =>
						item.id === h3Id
							? { ...item, name: newName }
							: item
					),
				};
			}
			return section;
		});
		onOutlineChange(newOutline);
	};

	const handleReorderH3 = (
		sectionId: string,
		oldIndex: number,
		newIndex: number
	) => {
		const newOutline = outline.map((section) => {
			if (section.id === sectionId) {
				const newItems = arrayMove(
					section.items,
					oldIndex,
					newIndex
				);
				return { ...section, items: newItems };
			}
			return section;
		});
		onOutlineChange(newOutline);
	};

	const activeSection = activeId
		? outline.find((section) => section.id === activeId)
		: null;

	return (
		<div className=''>
			<div className='flex flex-col gap-[14px] pb-[14px] mb-[14px] border-b border-lightgray'>
				
					<div className='text-base font-semibold text-black'>
						✅ Outline generated! Here's the proposed structure for your blog:
					</div>
			
				<div className='text-base font-normal text-[#777777]'>Tip: Drag to order & Click to edit</div>
			</div>
		

			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
			>
				<SortableContext
					items={outline.map((section) => section.id)}
					strategy={verticalListSortingStrategy}
				>
					<div className='space-y-[20px] text-sm mb-4'>
						{outline.map((section, index) => (
							<SortableH2Item
								key={section.id}
								section={section}
								index={index}
								onDeleteH2={handleDeleteH2}
								onEditH2={handleEditH2}
								onAddH3={handleAddH3}
								onDeleteH3={handleDeleteH3}
								onEditH3={handleEditH3}
								onReorderH3={handleReorderH3}
							/>
						))}
					</div>
				</SortableContext>

				<DragOverlay>
					{activeSection ? (
						<div className='border-l-4 border-blue-400 pl-3 bg-white rounded-r-lg p-3 shadow-lg opacity-90'>
							<div className='font-semibold text-gray-800 text-sm'>
								{activeSection.name}
							</div>
						</div>
					) : null}
				</DragOverlay>
			</DndContext>

			{/* Add H2 Form */}
			<div className='mt-[18px] pt-[18px] border-t border-lightgray'>
				{isAddingH2 ? (
					<div className='flex items-center gap-2'>
						<input
							type='text'
							value={newH2Value}
							onChange={(e) =>
								setNewH2Value(e.target.value)
							}
							onKeyDown={handleH2KeyDown}
							placeholder='Enter new H2 heading...'
							className='flex-1 px-3 py-2 text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500'
							autoFocus
							aria-label='New H2 heading'
						/>
						<button
							onClick={handleAddH2}
							disabled={outline.length >= H2_MAX}
							className='px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed disabled:text-gray-500'
							aria-label='Add H2'
							tabIndex={0}
						>
							Add
						</button>
						<button
							onClick={() => {
								setIsAddingH2(false);
								setNewH2Value('');
							}}
							className='px-4 py-2 text-sm bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition-colors'
							aria-label='Cancel'
							tabIndex={0}
						>
							Cancel
						</button>
					</div>
				) : (
					<button
						onClick={() => setIsAddingH2(true)}
						className='flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary  w-full justify-center bg-offwhite rounded-[8px]'
						aria-label='Add new H2 heading'
						tabIndex={0}
						title={
							outline.length >= H2_MAX
								? `Maximum ${H2_MAX} H2 headings allowed`
								: 'Add new H2 heading'
						}
					>
						<PlusIcon2/>
						Add New H2 Heading
					</button>
				)}
			</div>
		</div>
	);
};

export default DraggableOutline;
