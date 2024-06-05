import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import './PostDetail.css';

const PostDetail = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [email, setEmail] = useState("");
  const [isEditing, setIsEditing] = useState(new URLSearchParams(location.search).get('editing') === 'true');
  const [editedTitle, setEditedTitle] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [newComment, setNewComment] = useState('');
  const [comments, setComments] = useState([]);
  const [showEditDeleteButtons, setShowEditDeleteButtons] = useState(false);
  const [imageUrl, setImageUrl] = useState(""); // 이미지 URL 상태 추가

  useEffect(() => {
    const storedImageUrl = sessionStorage.getItem('imageUrl'); // 세션 스토리지에서 이미지 URL 가져오기
    if (storedImageUrl) {
      setImageUrl(storedImageUrl);
    }
  }, []);

  useEffect(() => {
    console.log('이미지 URL:', post?.imageUrl);
  }, [post]);  

  useEffect(() => {
    if (isEditing) {
      sessionStorage.setItem('editedTitle', editedTitle);
      sessionStorage.setItem('editedContent', editedContent);
    }
  }, [isEditing, editedTitle, editedContent]);

  useEffect(() => {
    if (isEditing) {
      const storedTitle = sessionStorage.getItem('editedTitle');
      const storedContent = sessionStorage.getItem('editedContent');
      if (storedTitle && storedContent) {
        setEditedTitle(storedTitle);
        setEditedContent(storedContent);
      } else {
        setEditedTitle(post?.title || '');
        setEditedContent(post?.content || '');
      }
    }
  }, [isEditing, post]);

  const fetchComments = useCallback(async () => {
    try {
      const response = await axios.get(`/api/posts/${id}/comments`);
      setComments(response.data);
    } catch (error) {
      console.error('댓글을 불러오는 중 오류 발생:', error);
    }
  }, [id]);

  useEffect(() => {
    const fetchPost = async () => {
      try {
        const response = await axios.get(`/api/posts/${id}`);
        setPost(response.data);
        setLoading(false);
      } catch (error) {
        console.error('게시글을 불러오는 중 오류 발생:', error);
        setError('게시글을 불러오는 중 오류가 발생했습니다.');
      }
    };

    const emailFromSession = sessionStorage.getItem("email");
    if (emailFromSession) {
      setEmail(emailFromSession);
    }

    fetchPost();
    fetchComments();
  }, [id, fetchComments]);

  useEffect(() => {
    setIsEditing(new URLSearchParams(location.search).get('editing') === 'true');
  }, [location.search]);

  const handleClick = () => {
    navigate('/home');
  };

  const handleEdit = () => {
    navigate(`?editing=true`);
    setIsEditing(true);
    setEditedTitle(post.title);
    setEditedContent(post.content);
  };

  const handleSave = async () => {
    try {
      if (!editedTitle.trim() || !editedContent.trim()) {
        alert('제목과 내용을 모두 입력하세요.');
        return;
      }

      await axios.put(`/api/posts/${id}`, {
        title: editedTitle,
        content: editedContent,
        author: post.author,
      });

      const response = await axios.get(`/api/posts/${id}`);
      setPost(response.data);

      setIsEditing(false);
      sessionStorage.removeItem('editedTitle');
      sessionStorage.removeItem('editedContent');
      alert('수정되었습니다.');
    } catch (error) {
      console.error('게시글을 수정하는 중 오류 발생:', error);
      setError('게시글을 수정하는 중 오류가 발생했습니다.');
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    sessionStorage.removeItem('editedTitle');
    sessionStorage.removeItem('editedContent');
  };

  const handleDelete = async () => {
    try {
      await axios.delete(`/api/posts/${id}`);
      alert('삭제되었습니다.');
      navigate('/home');
    } catch (error) {
      console.error('게시글을 삭제하는 중 오류 발생:', error);
      setError('게시글을 삭제하는 중 오류가 발생했습니다.');
    }
  };

  const handleCommentSubmit = async () => {
    try {
      if (!newComment.trim()) {
        alert('댓글을 입력하세요.');
        return;
      }

      await axios.post(`/api/posts/${id}/comments`, {
        author: email,
        content: newComment,
      });

      fetchComments();
      setNewComment('');
    } catch (error) {
      console.error('댓글 작성 중 오류 발생:', error);
      setError('댓글 작성 중 오류가 발생했습니다.');
    }
  };

  const handleImageClick = () => {
    setShowEditDeleteButtons(!showEditDeleteButtons);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>{error}</div>;
  }

  return (
    <div>
      <button onClick={handleClick} style={{ cursor: 'pointer', border: 'none', background: 'none', width: '300px', display: 'block', margin: '0 auto', outline: 'none' }}>
        <img src="/Home.jpg" alt="Go to Home" style={{ width: '250px', height: '120px' }} />
      </button>
      {!isEditing && (
        <div className="postdetail-box">
          <h1>{post.title}</h1>
          <p>카테고리: {post.category} | 작성자: {post.author} | 작성일: {new Date(post.created_at).toLocaleDateString('ko-KR')}</p>
          {/* 이미지 보여주기 */}
          {post.imageUrl && <img src={post.imageUrl} alt="Post" style={{ maxWidth: '100%', maxHeight: '300px', marginBottom: '10px' }} />}
          <hr />
          <div className="content-wrapper">
            <p>{post.content}</p>
            <hr />
          </div>
          <span>
            <button onClick={handleImageClick} className="toggle-button">
              <img src="/Button.png" alt="Show Edit/Delete" />
            </button>
            {showEditDeleteButtons && email === post.author && (
              <div className="button-container">
                <button className="edit-button" onClick={handleEdit}>수정</button>
                <div className="vertical-separator"></div> {/* 세로 경계선 추가 */}
                <button className="delete-button" onClick={handleDelete}>삭제</button>
              </div>
            )}
          </span>
          {/* 댓글 작성 폼은 게시글 상자 안에 있습니다. */}
          <div className="comments-section">
            <h2>댓글</h2>
            <textarea rows="4" cols="50" value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="댓글을 입력하세요" />
            <button className="comment-button" onClick={handleCommentSubmit}>작성</button>
            {/* 댓글 목록은 댓글 작성 폼 아래에 표시되며 스크롤 가능합니다. */}
            <div className="comments-scroll" style={{ maxHeight: '150px', overflowY: 'auto' }}>
              <ul>
                {comments.map((comment, index) => (
                  <li key={comment.comment_id} className="comment-item">
                    <p>작성자: {comment.author}</p>
                    <p>{comment.content}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
      {isEditing && (
        <div>
          <input type="text" className="edit-input" value={editedTitle} onChange={(e) => setEditedTitle(e.target.value)} />
          <textarea className="edit-textarea" value={editedContent} onChange={(e) => setEditedContent(e.target.value)} />
          <button className="save-button" onClick={handleSave}>저장</button>
          <button className="cancel-button" onClick={handleCancel}>취소</button>
        </div>
      )}
    </div>
  );
};

export default PostDetail;